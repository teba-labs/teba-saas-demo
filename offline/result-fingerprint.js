const encoder=new TextEncoder();
function stable(value){
  if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function base64Url(bytes){
  let binary='';for(const byte of new Uint8Array(bytes))binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}

/** Fingerprints only stable clinical content, not local/server UUID aliases or mutable workflow status. */
export async function fingerprintVisitResults({visitTests=[],results=[]}={}){
  const testById=new Map();
  const tests=(visitTests||[]).map(row=>{
    testById.set(row.id,row);
    return {test_id:row.test_id,code:row.test_code_snapshot??null,name:row.test_name_snapshot??null};
  }).sort((a,b)=>String(a.test_id).localeCompare(String(b.test_id)));
  const latest=new Map();
  for(const row of [...(results||[])].sort((a,b)=>String(a.entered_at??'').localeCompare(String(b.entered_at??''))||String(a.id??'').localeCompare(String(b.id??'')))){
    const test=testById.get(row.visit_test_id);
    if(!test)continue;
    const key=`${test.test_id}:${row.parameter_code}`;
    latest.set(key,{
      test_id:test.test_id,
      parameter_code:row.parameter_code,
      value_numeric:row.value_numeric===null||row.value_numeric===undefined?null:Number(row.value_numeric),
      value_text:row.value_text??null,
      flag:row.flag??null,
    });
  }
  const normalized={tests,results:[...latest.values()].sort((a,b)=>String(a.test_id).localeCompare(String(b.test_id))||String(a.parameter_code).localeCompare(String(b.parameter_code)))};
  return base64Url(await crypto.subtle.digest('SHA-256',encoder.encode(stable(normalized))));
}
