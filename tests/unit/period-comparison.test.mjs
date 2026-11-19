import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../../modules/dashboard/period-comparison.js', import.meta.url), 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
assert.deepEqual(mod.getPreviousMonthRange('2026-01-01'), { monthStart: '2025-12-01', monthEnd: '2026-01-01' });
assert.deepEqual(mod.getPreviousMonthRange('2024-03-01'), { monthStart: '2024-02-01', monthEnd: '2024-03-01' });
assert.throws(() => mod.getPreviousMonthRange('2026-13-01'));
const rows = mod.compareDashboardPeriods(
  { totals: { grossBilled: 180, discounts: 30, collected: 120, expenses: 30, visits: 8, patients: 7, tests: 10, netCash: 90, netBilled: 150, receivables: 20, paymentCount: 12, expenseCount: 3 } },
  { totals: { grossBilled: 120, discounts: 20, collected: 100, expenses: 25, visits: 4, patients: 4, tests: 5, netCash: 75, netBilled: 100, receivables: 0, paymentCount: 10, expenseCount: 2 } }
);
assert.equal(rows.find(x => x.key === 'grossBilled').difference, 60);
assert.equal(rows.find(x => x.key === 'discounts').difference, 10);
assert.equal(rows.find(x => x.key === 'collected').difference, 20);
assert.equal(rows.find(x => x.key === 'collected').changePercent, 20);
assert.equal(rows.find(x => x.key === 'expenses').difference, 5);
assert.equal(rows.find(x => x.key === 'paymentCount').difference, 2);
assert.equal(rows.find(x => x.key === 'expenseCount').difference, 1);
assert.equal(rows.find(x => x.key === 'receivables').changePercent, null);
assert.equal(rows.find(x => x.key === 'visits').changePercent, 100);
console.log('PASS: previous-month range and dashboard period comparison calculations');
