const XLSX_URL = 'https://esm.sh/xlsx@0.18.5';
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_SHEETS = 50;

function cleanCell(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}
function headerCandidates(rows) {
  return rows.slice(0, 15).map((row, index) => {
    const values = (row || []).map(cleanCell).filter(Boolean);
    const unique = new Set(values.map(v => v.toLocaleLowerCase('ar')));
    return { rowIndex: index, nonEmpty: values.length, unique: unique.size, score: values.length + unique.size * 0.25, values: (row || []).map(cleanCell), preview: rows.slice(index + 1, index + 6).map(next => next.map(cleanCell)) };
  }).filter(x => x.nonEmpty >= 2).sort((a,b) => b.score-a.score).slice(0,5);
}
function hashHex(buffer) {
  return crypto.subtle.digest('SHA-256', buffer).then(bytes =>
    [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('')
  );
}

/** Reads workbook bytes in this browser tab only. It never uploads or persists source rows. */
export async function inspectWorkbookFile(file) {
  if (!(file instanceof File)) throw new Error('اختر ملف Excel أو CSV أولًا.');
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error('الملفات المدعومة الآن: XLSX وXLS وCSV.');
  if (!file.size || file.size > MAX_FILE_BYTES) throw new Error('حجم الملف يجب أن يكون أقل من 20 ميجابايت.');
  if (!globalThis.crypto?.subtle) throw new Error('المتصفح لا يدعم فحص بصمة الملف بأمان. افتح الصفحة عبر HTTPS.');
  const buffer = await file.arrayBuffer();
  const [sha256, XLSX] = await Promise.all([hashHex(buffer), import(XLSX_URL)]);
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, raw: false });
  if (!workbook.SheetNames.length || workbook.SheetNames.length > MAX_SHEETS) {
    throw new Error('عدد أوراق العمل غير صالح أو يتجاوز الحد المسموح (50 ورقة).');
  }
  const sheets = workbook.SheetNames.map(name => {
    const worksheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: false, blankrows: false });
    const candidates = headerCandidates(rows);
    const suggested = candidates[0]?.rowIndex ?? 0;
    const header = (rows[suggested] || []).map(cleanCell);
    const preview = rows.slice(suggested + 1, suggested + 6).map(row => row.map(cleanCell));
    return {
      name, rowCount: rows.filter(row => row.some(cell => cleanCell(cell) !== '')).length,
      headerRowIndex: suggested, headerCandidates: candidates,
      headers: header, preview,
    };
  });
  return {
    fileName: file.name, fileSize: file.size, sha256,
    sheetCount: sheets.length, sheets,
    inspectedAt: new Date().toISOString(),
    privacy: 'local-only',
  };
}
