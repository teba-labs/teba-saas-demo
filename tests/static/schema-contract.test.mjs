import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RPC } from '../../core/data/schema-contract.js';

test('central RPC contract matches the idempotent reception intake implementation', async () => {
  const repository = await readFile(new URL('../../modules/reception/repository.js', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../../database/migrations/007_offline_idempotent_visit_intake.sql', import.meta.url), 'utf8');
  assert.equal(RPC.createVisitIntakeIdempotent, 'create_visit_intake_idempotent');
  assert.match(repository, /create_visit_intake_idempotent/);
  assert.match(migration, /create or replace function public\.create_visit_intake_idempotent/i);
  assert.equal(Object.hasOwn(RPC, 'createVisitIntake'), false);
});
