import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzeArchiveSheet, inspectLegacyDate, suggestColumnMapping } from '../../modules/migration/workbook-inspector.js';

test('historical sheet supports repeated wide parameter columns without treating them as duplicate field mappings', () => {
  const headers = ['Patient Name', 'Date', 'Test', 'Hb', 'WBC', 'Unit', 'Range'];
  const mapping = suggestColumnMapping(headers, 'historical_results');
  mapping[3] = { columnIndex: 3, header: 'Hb', fieldKey: 'parameter_columns', confidence: 'manual' };
  mapping[4] = { columnIndex: 4, header: 'WBC', fieldKey: 'parameter_columns', confidence: 'manual' };
  const analysis = analyzeArchiveSheet([
    headers,
    ['Test Patient', '2024-01-02', 'CBC', '12.4', '6.2', 'g/dL', '12-16']
  ], 0, 'historical_results', mapping);
  assert.equal(analysis.missingRequired, 0);
  assert.deepEqual(analysis.records[0].parameter_columns, { Hb: '12.4', WBC: '6.2' });
});

test('ambiguous legacy dates are never silently normalized', () => {
  assert.equal(inspectLegacyDate('01/02/2024').status, 'ambiguous');
  assert.equal(inspectLegacyDate('2024-02-01').isoDate, '2024-02-01');
  assert.equal(inspectLegacyDate('2024-02-01T00:00:00.000Z').isoDate, '2024-02-01');
});

test('historical importer is separate from operational visits and uses tenant/branch idempotency', async () => {
  const repository = await readFile(new URL('../../modules/migration/historical-results-repository.js', import.meta.url), 'utf8');
  const importer = await readFile(new URL('../../assets/js/data-import.js', import.meta.url), 'utf8');
  assert.match(repository, /from\('historical_results'\)/);
  assert.match(repository, /onConflict: 'tenant_id,branch_id,source_record_key'/);
  assert.match(repository, /from\('historical_import_batches'\)/);
  assert.match(repository, /storage\.from\('tenant-backups'\)/);
  assert.match(importer, /confirm\(/);
  assert.match(importer, /source_sheet_name/);
  assert.doesNotMatch(repository, /from\('visits'\)\.insert/);
  assert.doesNotMatch(repository, /from\('financial_ledger'\)\.insert/);
});

test('historical results are opt-in in reception and results screens', async () => {
  const reception = await readFile(new URL('../../app/reception.html', import.meta.url), 'utf8');
  const results = await readFile(new URL('../../app/results-workbench.html', import.meta.url), 'utf8');
  const settings = await readFile(new URL('../../app/settings.html', import.meta.url), 'utf8');
  assert.match(reception, /patientHistoricalPanel/);
  assert.match(results, /showHistoricalToggle[^>]*type="checkbox"/);
  assert.match(settings, /داتا المعمل القديمة/);
});
