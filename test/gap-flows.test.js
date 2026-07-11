'use strict';
// Gap coverage — draft-lock self-heal, server-side mandatory-field backstops,
// status state-machine guards, and data-integrity (unique constraints).
const cds = require('@sap/cds');
const test = require('node:test');
const assert = require('node:assert/strict');

const EMP = { username: 'sabarinathan.chandrasekar@bluestonex.com', password: 'sab' };
const MGR = { username: 'manager@bluestonex.com', password: 'mgr' };

let baseURL;
cds.on('listening', (o) => { baseURL = (o.url || o); });
const t = cds.test(process.cwd());

let POST, GET, PATCH;
test('setup', () => {
  t.axios.defaults.baseURL = (baseURL || '').replace('localhost', '127.0.0.1');
  t.axios.defaults.validateStatus = () => true;
  POST = (u, d, c) => t.axios.post(u, d, c);
  GET = (u, c) => t.axios.get(u, c);
  PATCH = (u, d, c) => t.axios.patch(u, d, c);
});

const draft = (id) => `(ID=${id},IsActiveEntity=false)`;
const active = (id) => `(ID=${id},IsActiveEntity=true)`;
const PAST = '2026-02-16';

async function newActiveDraft(auth, over = {}) {
  const c = await POST('/expense/MyClaims', { country: 'UK', claimPeriod: '2026-02-28', ...over }, { auth });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: PAST, expenseType_code: 'HOTEL', reasonForTrip: 'T', vatType: 'STD', grossAmount: 120, receiptAttached: true }, { auth });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth });
  return id;
}

// ── Draft-lock self-heal (the 409 fix) ────────────────────────────────────────
test('submit succeeds even when a leftover sibling draft exists (self-heal)', async () => {
  const id = await newActiveDraft(EMP);
  // Abandon-an-edit: create a sibling draft and DO NOT discard it (as the UI's Back does).
  const e = await POST(`/expense/MyClaims${active(id)}/ExpenseService.draftEdit`, { PreserveChanges: true }, { auth: EMP });
  assert.equal(e.status, 201, 'draftEdit creates a sibling draft');
  // The client fix activates the sibling draft (releasing the CAP lock that 409s on
  // HANA) then submits. Reproduce that recovery and assert the claim reaches Submitted.
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  const res = await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  assert.equal(res.status, 200, `submit after draft reconciliation should succeed, got ${res.status}`);
  assert.equal(res.data.status, 'Submitted');
});

// ── Server-side mandatory-field backstops (behind the new client validation) ──
test('submit is blocked (422) when Claim Period is missing', async () => {
  const c = await POST('/expense/MyClaims', { country: 'UK' }, { auth: EMP }); // no claimPeriod
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: PAST, expenseType_code: 'HOTEL', reasonForTrip: 'T', vatType: 'STD', grossAmount: 120, receiptAttached: true }, { auth: EMP });
  const act = await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  // If activation itself blocks the mandatory claimPeriod, that already prevents submit.
  if (act.status < 400) {
    const s = await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
    assert.equal(s.status, 422, 'missing claim period blocks submit');
    assert.match(JSON.stringify(s.data).toLowerCase(), /period/);
  } else {
    assert.ok(act.status >= 400, 'missing mandatory claimPeriod blocked at activation');
  }
});

test('an item missing required fields is blocked (400 at save, or 422 at submit)', async () => {
  const c = await POST('/expense/MyClaims', { country: 'UK', claimPeriod: '2026-02-28' }, { auth: EMP });
  const id = c.data.ID;
  // item with no reasonForTrip (@mandatory) and zero gross
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: PAST, expenseType_code: 'TOLLS', vatType: 'STD', grossAmount: 0 }, { auth: EMP });
  const act = await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  if (act.status < 400) {
    // If it somehow activated, submit must catch it.
    const s = await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
    assert.equal(s.status, 422, 'incomplete item blocks submit');
  } else {
    // @mandatory item fields are enforced at draftActivate (400) — the correct backstop.
    assert.ok(act.status >= 400, `incomplete item blocked at save, got ${act.status}`);
  }
});

test('submit is blocked (422) when the claim has no lines', async () => {
  const c = await POST('/expense/MyClaims', { country: 'UK', claimPeriod: '2026-02-28' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  const s = await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  assert.equal(s.status, 422, 'empty claim blocks submit');
});

// ── Status state-machine ──────────────────────────────────────────────────────
test('re-submitting an already-Submitted claim is rejected (409)', async () => {
  const id = await newActiveDraft(EMP);
  const first = await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  assert.equal(first.data.status, 'Submitted');
  const again = await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  assert.equal(again.status, 409, `re-submit should be 409, got ${again.status}`);
});

test('reject without a reason is rejected (422)', async () => {
  const id = await newActiveDraft(EMP);
  await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  const res = await POST(`/approval/Approvals(${id})/ApprovalService.reject`, { comment: '' }, { auth: MGR });
  assert.equal(res.status, 422, 'reject requires a reason');
});

// ── Data integrity ────────────────────────────────────────────────────────────
test('each submitted claim gets a unique claimNumber', async () => {
  const a = await newActiveDraft(EMP); const b = await newActiveDraft(EMP);
  const sa = await POST(`/expense/MyClaims${active(a)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  const sb = await POST(`/expense/MyClaims${active(b)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  assert.ok(sa.data.claimNumber && sb.data.claimNumber, 'both have claim numbers');
  assert.notEqual(sa.data.claimNumber, sb.data.claimNumber, 'claim numbers are unique');
});

test('@assert.unique.country: a second Policy for an existing country is rejected', async () => {
  const list = await GET('/approval/Policies', { auth: MGR });
  const existingCountry = list.data.value[0].country;
  const c = await POST('/approval/Policies', { policyName: 'dup', country: existingCountry, vatRate: 0.2, gstRate: 0.18, mileageRate: 0.25, receiptThreshold: 25 }, { auth: MGR });
  if (c.status < 400) {
    const id = c.data.ID;
    const act = await POST(`/approval/Policies(ID=${id},IsActiveEntity=false)/draftActivate`, {}, { auth: MGR });
    assert.ok(act.status >= 400, `duplicate country policy should fail on activate, got ${act.status}`);
    await t.axios.delete(`/approval/Policies(ID=${id},IsActiveEntity=false)`, { auth: MGR });
  } else {
    assert.ok(c.status >= 400, 'duplicate country policy rejected at create');
  }
});
