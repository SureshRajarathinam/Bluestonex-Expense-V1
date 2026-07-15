'use strict';
// Gap coverage — Admin config validation (Policy/Workflow boundaries) and the
// separation-of-duties guard on approve/reject.
const cds = require('@sap/cds');
const test = require('node:test');
const assert = require('node:assert/strict');

const MGR = { username: 'manager@bluestonex.com', password: 'mgr' };   // UK L1 approver (+Employee)
const IN1 = { username: 'suresh.rajarathinam@bluestonex.com', password: 'suresh' }; // India L1 (+Employee)
const CLERK = { username: 'clerk@bluestonex.com', password: 'clerk' }; // Employee only

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

// Create + submit a valid claim as the given user (HOTEL £120 with a receipt).
async function submitAs(auth, country) {
  const period = country === 'IN' ? '2026-02-28' : '2026-02-28';
  const c = await POST('/expense/MyClaims', { country, claimPeriod: period }, { auth });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', reasonForTrip: 'T', vatType: 'STD', grossAmount: 120, receiptAttached: true }, { auth });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth });
  await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth });
  return id;
}

// ── Approval authority = workflow membership (not authorship) ─────────────────
// Per requirement: whoever is the configured approver for the country may act,
// even on a claim they created themselves. Non-approvers are still blocked (403),
// covered by the "approver IDENTITY" test in approval.test.js.
const statusOf = async (id, auth) => (await GET(`/expense/MyClaims${active(id)}`, { auth })).data.status;

test('authority: the configured UK L1 approver CAN approve their own claim', async () => {
  const id = await submitAs(MGR, 'UK'); // manager IS the UK L1 approver
  const res = await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'self' }, { auth: MGR });
  assert.ok(res.status < 400, `own-claim approval by the configured approver should succeed, got ${res.status}`);
  assert.equal(await statusOf(id, MGR), 'FirstApproved', 'UK L1 approval advances the claim');
});

test('authority: the configured approver CAN return their own claim', async () => {
  const id = await submitAs(MGR, 'UK');
  const res = await POST(`/approval/Approvals(${id})/ApprovalService.reject`, { comment: 'needs a fix' }, { auth: MGR });
  assert.ok(res.status < 400, `own-claim return by the configured approver should succeed, got ${res.status}`);
  assert.equal(await statusOf(id, MGR), 'Returned', 'return sends it back for rework');
});

test('authority: India single-level approver CAN approve their own claim (→ Approved)', async () => {
  const id = await submitAs(IN1, 'IN'); // suresh IS the India L1 approver
  const res = await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'self' }, { auth: IN1 });
  assert.ok(res.status < 400, `own-claim approval (India) should succeed, got ${res.status}`);
  assert.equal(await statusOf(id, IN1), 'Approved', 'single-level India approval completes it');
});

// ── Policy configuration validation boundaries (before('SAVE','Policies')) ────
async function editPolicy(patch) {
  const list = await GET('/approval/Policies', { auth: MGR });
  const id = list.data.value[0].ID;
  await POST(`/approval/Policies(ID=${id},IsActiveEntity=true)/ApprovalService.draftEdit`, { PreserveChanges: false }, { auth: MGR });
  await PATCH(`/approval/Policies(ID=${id},IsActiveEntity=false)`, patch, { auth: MGR });
  const act = await POST(`/approval/Policies(ID=${id},IsActiveEntity=false)/draftActivate`, {}, { auth: MGR });
  // clean up: if it activated (valid case), leave it; if it failed, discard the draft
  if (act.status >= 400) { await t.axios.delete(`/approval/Policies(ID=${id},IsActiveEntity=false)`, { auth: MGR }); }
  return act;
}

test('Policy: mileageRate <= 0 is rejected', async () => {
  assert.ok((await editPolicy({ mileageRate: 0 })).status >= 400, 'zero mileage rate rejected');
  assert.ok((await editPolicy({ mileageRate: -0.1 })).status >= 400, 'negative mileage rate rejected');
});

// (Removed: Policy no longer holds vatRate/gstRate — the tax rate lives per
//  treatment on TAX_TYPES, so there is no rate field on Policy to range-check.)

test('Policy: negative limits/threshold are rejected', async () => {
  assert.ok((await editPolicy({ receiptThreshold: -1 })).status >= 400, 'negative threshold rejected');
  assert.ok((await editPolicy({ hotelDailyLimit: -5 })).status >= 400, 'negative hotel limit rejected');
});

test('Policy: a valid edit is accepted', async () => {
  const res = await editPolicy({ receiptThreshold: 30 });
  assert.ok(res.status < 400, `valid policy edit should succeed, got ${res.status}`);
});

// ── Workflow member email-format validation (before('SAVE','WorkflowMembers')) ─
test('Workflow: a malformed approver email is rejected', async () => {
  const wf = await GET('/approval/WorkflowMembers', { auth: MGR });
  const country = wf.data.value[0].country;
  await POST(`/approval/WorkflowMembers(country='${country}',IsActiveEntity=true)/ApprovalService.draftEdit`, { PreserveChanges: false }, { auth: MGR });
  await PATCH(`/approval/WorkflowMembers(country='${country}',IsActiveEntity=false)`, { firstApprover: 'not-an-email' }, { auth: MGR });
  const act = await POST(`/approval/WorkflowMembers(country='${country}',IsActiveEntity=false)/draftActivate`, {}, { auth: MGR });
  assert.ok(act.status >= 400, `malformed email should be rejected, got ${act.status}`);
  await t.axios.delete(`/approval/WorkflowMembers(country='${country}',IsActiveEntity=false)`, { auth: MGR });
});

test('Non-admin cannot read Policies (403)', async () => {
  assert.equal((await GET('/approval/Policies', { auth: CLERK })).status, 403);
});
