import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pages = [
  'app/index.html',
  'app/reception.html',
  'app/results-workbench.html',
  'app/result-entry.html',
  'app/catalog.html',
  'app/workday.html',
  'app/dashboard.html',
  'app/settings.html',
  'app/sync-center.html',
  'app/cms-editor.html',
  'app/site-management.html',
  'app/data-import.html',
  'portal/index.html'
];

test('all core workspaces load the shared responsive viewport layer', async () => {
  for (const page of pages) {
    const html = await readFile(page, 'utf8');
    assert.match(html, /name=["']viewport["'][^>]*width=device-width/i, page + ' must declare a device-width viewport');
    assert.match(html, /app-viewport\.css/i, page + ' must load app-viewport.css');
  }
});

test('shared responsive layer provides zoom-aware reflow at desktop, tablet and phone widths', async () => {
  const css = await readFile('assets/css/app-viewport.css', 'utf8');
  for (const breakpoint of ['1099px', '767px', '420px']) {
    assert.ok(css.includes(breakpoint), 'missing responsive breakpoint ' + breakpoint);
  }
  for (const selector of ['.apps-grid', '.settings-tabs', '.collection-layout', '.table-wrap', '.fields']) {
    assert.ok(css.includes(selector), 'missing shared responsive selector ' + selector);
  }
});

test('reception has a three-column desktop and collapsible mobile intake layout', async () => {
  const css = await readFile('assets/css/reception.css', 'utf8');
  assert.match(css, /\.intake-content\s*\{[^}]*grid-template-columns:\s*minmax\(280px/i);
  assert.match(css, /\.intake-column\[open\]/);
  assert.match(css, /max-width:\s*767px/);
});

test('results workbench has desktop columns and actual mobile section tabs', async () => {
  const html = await readFile('app/results-workbench.html', 'utf8');
  const css = await readFile('assets/css/results-workbench.css', 'utf8');
  assert.match(html, /results-mobile-tabs/);
  assert.match(css, /\.results-mobile-tabs\s*\{\s*display:\s*none/);
  assert.match(css, /\.results-column\.is-mobile-active/);
  assert.match(css, /max-width:\s*767px/);
});

test('service worker cache version is bumped and Supabase responses remain uncached', async () => {
  const sw = await readFile('service-worker.js', 'utf8');
  assert.match(sw, /taiba-smart-lab-shell-v47/);
  assert.match(sw, /\.supabase\.co.*Never cache authenticated API or patient data/i);
});
