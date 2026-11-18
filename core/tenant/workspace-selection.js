// Local workspace selection is a convenience only, never an authorization source.
// Every selected tenant/branch is revalidated against the current Auth membership context.
const STORAGE_KEY = 'taiba-smart-lab.workspace-selection.v1';

function readSelection() {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { tenantId: value.tenantId || null, branches: value.branches && typeof value.branches === 'object' ? value.branches : {} }
      : { tenantId: null, branches: {} };
  } catch {
    return { tenantId: null, branches: {} };
  }
}

function writeSelection(selection) {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(selection)); } catch { /* storage may be unavailable */ }
}

export function getPreferredTenantId(tenants = []) {
  const selection = readSelection();
  const preferred = tenants.find(tenant => tenant.id === selection.tenantId);
  const selectedId = preferred?.id || tenants[0]?.id || null;
  if (selectedId) { selection.tenantId = selectedId; writeSelection(selection); }
  return selectedId;
}

export function getPreferredBranchId(tenantId, branches = []) {
  if (!tenantId || !branches.length) return null;
  const selection = readSelection();
  const preferred = branches.find(branch => branch.id === selection.branches[tenantId]);
  const selectedId = preferred?.id || branches[0]?.id || null;
  if (selectedId) {
    selection.tenantId = tenantId;
    selection.branches[tenantId] = selectedId;
    writeSelection(selection);
  }
  return selectedId;
}

export function rememberWorkspaceSelection(tenantId, branchId = null) {
  if (!tenantId) return;
  const selection = readSelection();
  selection.tenantId = tenantId;
  if (branchId) selection.branches[tenantId] = branchId;
  writeSelection(selection);
}
