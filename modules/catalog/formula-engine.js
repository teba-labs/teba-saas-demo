const tokenPattern = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([()+*/-]))/gy;

export function parseFormulaExpression(source, parameters = [], currentCode = '') {
  const text = String(source ?? '').trim();
  if (!text) throw new Error('اكتب المعادلة الحسابية أولًا.');
  const tokens = [];
  let position = 0;
  while (position < text.length) {
    tokenPattern.lastIndex = position;
    const match = tokenPattern.exec(text);
    if (!match) throw new Error('صيغة المعادلة غير مفهومة قرب: ' + text.slice(position));
    tokens.push(match[1] !== undefined ? { type: 'number', value: Number(match[1]) }
      : match[2] !== undefined ? { type: 'parameter', value: match[2] }
      : { type: match[3], value: match[3] });
    position = tokenPattern.lastIndex;
  }

  let index = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++];
  const primary = () => {
    const token = take();
    if (!token) throw new Error('المعادلة غير مكتملة.');
    if (token.type === 'number') return { const: token.value };
    if (token.type === 'parameter') return { param: token.value };
    if (token.type === '-') return { op: 'multiply', args: [{ const: -1 }, primary()] };
    if (token.type === '+') return primary();
    if (token.type === '(') {
      const value = expression();
      if (take()?.type !== ')') throw new Error('يوجد قوس غير مغلق.');
      return value;
    }
    throw new Error('عنصر غير صالح في المعادلة.');
  };
  const product = () => {
    let value = primary();
    while (peek()?.type === '*' || peek()?.type === '/') {
      const operator = take().type;
      value = { op: operator === '*' ? 'multiply' : 'divide', args: [value, primary()] };
    }
    return value;
  };
  const expression = () => {
    let value = product();
    while (peek()?.type === '+' || peek()?.type === '-') {
      const operator = take().type;
      value = { op: operator === '+' ? 'add' : 'subtract', args: [value, product()] };
    }
    return value;
  };

  const formula = expression();
  if (index !== tokens.length) throw new Error('يوجد جزء زائد بعد نهاية المعادلة.');
  const references = [];
  const visit = node => {
    if (node.param) references.push(node.param);
    else if (node.args) node.args.forEach(visit);
  };
  visit(formula);
  if (!references.length) throw new Error('المعادلة يجب أن تعتمد على بارامتر واحد على الأقل.');
  const active = new Map(parameters.filter(parameter => parameter.is_active).map(parameter => [parameter.parameter_code, parameter]));
  for (const code of references) {
    const parameter = active.get(code);
    if (!parameter) throw new Error('البارامتر ' + code + ' غير موجود أو موقوف في نفس التحليل.');
    if (parameter.value_type !== 'numeric') throw new Error('البارامتر ' + code + ' ليس رقميًا.');
    if (code === String(currentCode).trim()) throw new Error('لا يمكن أن يعتمد البارامتر على نفسه.');
  }
  return formula;
}

export function formulaToExpression(node) {
  if (!node) return '';
  if (node.param) return node.param;
  if (node.const !== undefined) return String(node.const);
  const operator = { add: '+', subtract: '-', multiply: '*', divide: '/' }[node.op];
  if (!operator) return '';
  return '(' + formulaToExpression(node.args?.[0]) + ' ' + operator + ' ' + formulaToExpression(node.args?.[1]) + ')';
}
