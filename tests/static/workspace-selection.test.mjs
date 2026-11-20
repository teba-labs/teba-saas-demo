import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getPreferredTenantId, getPreferredBranchId, rememberWorkspaceSelection } from '../../core/tenant/workspace-selection.js';

const values = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key),
} });

const tenants = [
  { id: 'tenant-a', branches: [{ id: 'a1' }, { id: 'a2' }] },
  { id: 'tenant-b', branches: [{ id: 'b1' }] },
];

test('workspace preference keeps the selected tenant only when it is in the current Auth context', () => {
  rememberWorkspaceSelection('tenant-b');
  assert.equal(getPreferredTenantId(tenants), 'tenant-b');
  assert.equal(getPreferredTenantId([tenants[0]]), 'tenant-a');
});

test('branch preference is tenant-scoped and falls back when the branch is not authorized', () => {
  rememberWorkspaceSelection('tenant-a', 'a2');
  rememberWorkspaceSelection('tenant-b', 'b1');
  assert.equal(getPreferredBranchId('tenant-a', tenants[0].branches), 'a2');
  assert.equal(getPreferredBranchId('tenant-b', tenants[1].branches), 'b1');
  assert.equal(getPreferredBranchId('tenant-a', [{ id: 'a1' }]), 'a1');
});

test('changing tenant without a branch preserves its previous branch preference', () => {
  rememberWorkspaceSelection('tenant-a', 'a2');
  rememberWorkspaceSelection('tenant-b');
  assert.equal(getPreferredBranchId('tenant-a', tenants[0].branches), 'a2');
});

test('workspace-aware pages all use the same validated selection helper', async () => {
  const paths = [
    'assets/js/app-home.js',
    'assets/js/reception.js',
    'assets/js/results-workbench.js',
    'assets/js/workday.js',
    'assets/js/sync-center.js',
    'assets/js/catalog.js',
    'assets/js/dashboard.js',
    'assets/js/cms-editor.js',
    'assets/js/settings-center.js',
    'assets/js/tenant-branding.js',
  ];
  for (const path of paths) {
    const source = await readFile(new URL('../../' + path, import.meta.url), 'utf8');
    assert.match(source, /workspace-selection\.js/, path);
    assert.match(source, /getPreferredTenantId/, path);
  }
  const serviceWorker = await readFile(new URL('../../service-worker.js', import.meta.url), 'utf8');
  assert.match(serviceWorker, /workspace-selection\.js/);
  assert.match(serviceWorker, /taiba-smart-lab-shell-v26/);
});
