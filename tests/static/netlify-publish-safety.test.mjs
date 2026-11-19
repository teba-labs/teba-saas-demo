import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');

test('Netlify publishes only the browser-facing dist directory', () => {
  const config = read('netlify.toml');
  const build = read('scripts/build-netlify.sh');
  const preview = read('.github/workflows/netlify-test-preview.yml');

  assert.match(config, /command\s*=\s*"bash scripts\/build-netlify\.sh"/);
  assert.match(config, /publish\s*=\s*"dist"/);
  assert.match(build, /for directory in app assets config core dashboard modules offline portal website/);
  for (const excluded of ['database','docs','supabase','source_original','.github','tests','node_modules']) {
    assert.ok(build.includes(`test ! -e dist/${excluded}`), `deploy staging must exclude ${excluded}`);
  }
  assert.match(build, /test -f dist\/app\/index\.html/);
  assert.match(preview, /bash scripts\/build-netlify\.sh/);
  assert.doesNotMatch(config, /publish\s*=\s*"\."/);
});
