// ─────────────────────────────────────────────────────────────────────────────
//  srv/lib/identity.js — caller-identity gathering.
//
//  Proves the deployed-IdP fix: in Work Zone req.user.id is the LOGON NAME (e.g.
//  "Srajarathinam"), not the email that USERS_MASTER / Approval Workflow are keyed
//  on. callerIdentities must still surface the email (from token claims) so the
//  employee/approver lookup resolves. Pure unit test — no DB needed.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const { callerIdentities } = require('../srv/lib/identity');

test('gathers the email claim even when user.id is a logon name (the deployed-IdP case)', () => {
  const req = { user: { id: 'Srajarathinam', attr: { email: ['Suresh.Rajarathinam@bluestonex.com'] } } };
  const ids = callerIdentities(req);
  assert.ok(ids.has('srajarathinam'), 'includes the logon-name id (lower-cased)');
  assert.ok(ids.has('suresh.rajarathinam@bluestonex.com'),
    'includes the email claim (lower-cased) — this is what matches USERS_MASTER.Email');
});

test('accepts string OR array claims and trims + lower-cases every identity', () => {
  const req = { user: { id: 'User@X.com', attr: { mail: 'Mixed.Case@Y.com', user_name: '  loginX  ' } } };
  const ids = callerIdentities(req);
  assert.ok(ids.has('user@x.com'), 'id lower-cased');
  assert.ok(ids.has('mixed.case@y.com'), 'string mail claim lower-cased');
  assert.ok(ids.has('loginx'), 'user_name trimmed + lower-cased');
});

test('is safe when there are no attributes / no user', () => {
  assert.doesNotThrow(() => callerIdentities({ user: { id: 'a@b.com' } }));
  assert.doesNotThrow(() => callerIdentities({}));
  assert.equal(callerIdentities({}).size, 0, 'empty req → no identities');
});
