import assert from 'node:assert/strict';

const [mode, rawPort, marker] = process.argv.slice(2);
const port = Number(rawPort);
assert.ok(Number.isInteger(port) && port > 0 && port < 65536, 'A valid DevTools port is required');

async function findPage() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`DevTools endpoint returned HTTP ${response.status}`);
  const targets = await response.json();
  const page = targets.find(item => item.type === 'page' && item.url === 'taiba://app/app/index.html');
  if (!page) throw new Error('The installed local app renderer was not found');
  return page;
}

async function evaluate(expression) {
  const page = await findPage();
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  try {
    const result = await new Promise((resolve, reject) => {
      const id = 1;
      const onMessage = event => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.id !== id) return;
        socket.removeEventListener('message', onMessage);
        if (message.error) reject(new Error(message.error.message));
        else if (message.result?.exceptionDetails) reject(new Error(message.result.exceptionDetails.text || 'Renderer evaluation failed'));
        else resolve(message.result?.result?.value);
      };
      socket.addEventListener('message', onMessage);
      socket.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      }));
    });
    return result;
  } finally {
    socket.close();
  }
}

if (mode === 'wait') {
  const deadline = Date.now() + 45_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const page = await findPage();
      console.log(JSON.stringify({ title: page.title, url: page.url }));
      process.exit(0);
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  throw lastError || new Error('Timed out waiting for the local renderer');
}

if (mode === 'seed' || mode === 'verify') {
  assert.ok(marker && /^[a-f0-9]{16,64}$/i.test(marker), 'A hex marker is required');
  const expression = mode === 'seed'
    ? `(async()=>{const marker=${JSON.stringify(marker)};localStorage.setItem('taiba-cycle2-upgrade-settings',marker);const {offlineDb,assertOfflineDatabaseReady}=await import('/offline/database.js');await assertOfflineDatabaseReady();const now=new Date().toISOString();const operationId='cycle2-upgrade-'+marker;await offlineDb.sync_meta.put({key:'cycle2-upgrade-sentinel',tenant_id:'cycle2-upgrade-tenant',branch_id:'cycle2-upgrade-branch',marker,updated_at:now});await offlineDb.outbox.add({operation_id:operationId,tenant_id:'cycle2-upgrade-tenant',branch_id:'cycle2-upgrade-branch',entity_type:'upgrade-smoke',action:'persist',payload:{marker},depends_on:[],status:'pending',attempts:0,created_at:now,updated_at:now,next_attempt_at:now,lease_until:null,sync_owner:null,last_error:null});const root=await navigator.storage.getDirectory();const handle=await root.getFileHandle('taiba-cycle2-upgrade-sentinel.txt',{create:true});const writer=await handle.createWritable();await writer.write(marker);await writer.close();return {seeded:true,marker,operationId};})()`
    : `(async()=>{const marker=${JSON.stringify(marker)};const {offlineDb,assertOfflineDatabaseReady}=await import('/offline/database.js');await assertOfflineDatabaseReady();const setting=localStorage.getItem('taiba-cycle2-upgrade-settings');const meta=await offlineDb.sync_meta.get('cycle2-upgrade-sentinel');const operationId='cycle2-upgrade-'+marker;const queued=await offlineDb.outbox.where('operation_id').equals(operationId).first();const root=await navigator.storage.getDirectory();const handle=await root.getFileHandle('taiba-cycle2-upgrade-sentinel.txt');const file=await handle.getFile();const fileText=await file.text();const checks={localStorage:setting===marker,indexedDb:meta?.marker===marker,outbox:queued?.payload?.marker===marker&&queued.status==='pending',opfs:fileText===marker};return {checks,allPassed:Object.values(checks).every(Boolean)};})()`;
  const result = await evaluate(expression);
  console.log(JSON.stringify(result));
  if (mode === 'verify' && !result?.allPassed) process.exitCode = 1;
} else if (mode === 'close') {
  const result = await evaluate('window.close(); true');
  console.log(JSON.stringify({ closeRequested: result === true }));
} else {
  throw new Error('Usage: electron-devtools.mjs wait|seed|verify|close PORT [MARKER]');
}
