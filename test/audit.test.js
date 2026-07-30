'use strict';
// Unit — audit.js record(): the immutable audit-trail writer. Uses cds.test for a
// real (in-memory) AUDITLOG so we can assert what was persisted, plus the
// best-effort "never throws" contract.
const cds = require('@sap/cds');
const test = require('node:test');
const assert = require('node:assert/strict');
const audit = require('../srv/lib/audit');

cds.test(process.cwd());

test('record() persists with system-user fallback and truncates details to 1000 chars', async () => {
  await audit.record({ action: 'UNIT_AUDIT_A', details: 'x'.repeat(1500) });
  const { AUDITLOG } = cds.entities('EXP');
  const rows = await SELECT.from(AUDITLOG).where({ action: 'UNIT_AUDIT_A' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, 'system', 'missing userId defaults to system');
  assert.equal(rows[0].details.length, 1000, 'details capped at 1000 chars');
  assert.equal(rows[0].objectType, '');
  assert.equal(rows[0].objectKey, '');
  assert.ok(rows[0].timestamp, 'timestamp set');
});

test('record() keeps the provided userId/objectType/objectKey', async () => {
  await audit.record({ userId: 'u@bluestonex.com', action: 'UNIT_AUDIT_B', objectType: 'Claim', objectKey: 'C1', details: 'ok' });
  const { AUDITLOG } = cds.entities('EXP');
  const rows = await SELECT.from(AUDITLOG).where({ action: 'UNIT_AUDIT_B' });
  assert.equal(rows[0].userId, 'u@bluestonex.com');
  assert.equal(rows[0].objectType, 'Claim');
  assert.equal(rows[0].objectKey, 'C1');
});

test('record() swallows failures and never throws (malformed details)', async () => {
  // A non-string `details` makes the internal `(details||'').slice(...)` throw a
  // TypeError inside record()'s try — the best-effort catch must absorb it so the
  // caller (submit/approve) is never broken, and nothing is persisted.
  await assert.doesNotReject(() => audit.record({ action: 'UNIT_AUDIT_C', details: { not: 'a string' } }));
  const { AUDITLOG } = cds.entities('EXP');
  const rows = await SELECT.from(AUDITLOG).where({ action: 'UNIT_AUDIT_C' });
  assert.equal(rows.length, 0, 'failed audit write left no row');
});
