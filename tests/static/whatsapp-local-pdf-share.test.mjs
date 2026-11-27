import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../assets/js/results-workbench.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../../app/results-workbench.html', import.meta.url), 'utf8');
const worker = await readFile(new URL('../../service-worker.js', import.meta.url), 'utf8');

test('direct WhatsApp report sharing creates a local PDF and never uploads or signs a cloud file URL', () => {
  const start = source.indexOf('async function shareDirectReport(button){');
  const end = source.indexOf('async function searchHistorical', start);
  assert.ok(start >= 0 && end > start);
  const share = source.slice(start, end);
  assert.match(share, /new File\(\[blob\]/);
  assert.match(share, /URL\.createObjectURL\(file\)/);
  assert.match(share, /download\.click\(\)/);
  assert.match(share, /wa\.me\//);
  assert.match(share, /shareWindow\.location\.href=waUrl/);
  assert.doesNotMatch(share, /navigator\.share/);
  assert.match(share, /work-source-card/, 'resolve the source visit card after action-bar reparenting');
  assert.doesNotMatch(share, /uploadVisitAttachment|createAttachmentDownloadUrl|signedUrl|storage_path|createSignedUrl/);
});

test('no-portal WhatsApp action remains available and the updated module is precached', () => {
  assert.match(source, /share-direct-report/);
  assert.match(source, /!state\.portalEnabled && state\.portalConfigKnown/);
  assert.match(page, /visit-results-management-20261127-v3/);
  assert.match(worker, /taiba-smart-lab-shell-v100/);
  assert.match(worker, /visit-results-management-20261127-v3/);
});
