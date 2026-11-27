import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('reception and results workbench render historical results as readable values, not raw JSON dumps', () => {
  const reception = read('assets/js/reception.js');
  const workbench = read('assets/js/results-workbench.js');
  const renderer = read('modules/results/historical-display.js');
  assert.match(reception, /renderHistoricalResultValues\(row\.result_data\)/);
  assert.match(workbench, /renderHistoricalResultValues\(row\.result_data\)/);
  assert.doesNotMatch(reception, /JSON\.stringify\(row\.result_data/);
  assert.doesNotMatch(workbench, /JSON\.stringify\(row\.result_data/);
  assert.match(renderer, /createElement\('dl'\)/);
  assert.match(renderer, /textContent = entry\.value/);
});

test('historical result renderer is part of the offline application shell', () => {
  const worker = read('service-worker.js');
  assert.match(worker, /taiba-smart-lab-shell-v83/);
  assert.match(worker, /modules\/results\/historical-display\.js/);
});
