const cds = require('@sap/cds');
const test = require('node:test');
const assert = require('node:assert/strict');

const EMP = { username: 'sabarinathan.chandrasekar@bluestonex.com', password: 'sab' };
const MGR = { username: 'manager@bluestonex.com', password: 'mgr' };
const FIN = { username: 'Dan.Barton@bluestonex.com', password: 'dan' };
const CLERK = { username: 'clerk@bluestonex.com', password: 'clerk' }; // Employee only

let baseURL;
cds.on('listening', (o) => { baseURL = (o.url || o); });
const t = cds.test(process.cwd());

let POST, GET;
test('setup', () => {
  t.axios.defaults.baseURL = (baseURL || '').replace('localhost', '127.0.0.1');
  t.axios.defaults.validateStatus = () => true;
  POST = (u, d, c) => t.axios.post(u, d, c);
  GET = (u, c) => t.axios.get(u, c);
});

const draft = (id) => `(ID=${id},IsActiveEntity=false)`;
const active = (id) => `(ID=${id},IsActiveEntity=true)`;

async function submitUK() {
  const c = await POST('/expense/MyClaims', { country: 'UK', claimPeriod: '2026-02-28' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', reasonForTrip: 'T', vatType: 'STD', grossAmount: 120, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  return id;
}

test('approver IDENTITY: only the configured L1 can approve (others 403)', async () => {
  const id = await submitUK();
  // sab is an Approver by role but NOT the configured approver → 403
  const bad = await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'x' }, { auth: EMP });
  assert.equal(bad.status, 403, `non-configured approver should be 403, got ${bad.status}`);
  // Dan is the L2 approver, but the claim is at L1 → he is not the L1 approver yet → 403
  const wrongLevel = await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'x' }, { auth: FIN });
  assert.equal(wrongLevel.status, 403, `L2 approving at L1 should be 403, got ${wrongLevel.status}`);
  // manager (L1) succeeds
  const ok = await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'ok' }, { auth: MGR });
  assert.ok(ok.status < 400, `L1 approve ${ok.status}`);
});

test('reject requires a reason (422) then rejects with reason', async () => {
  const id = await submitUK();
  const noReason = await POST(`/approval/Approvals(${id})/ApprovalService.reject`, { comment: '' }, { auth: MGR });
  assert.equal(noReason.status, 422, `got ${noReason.status}`);
  const ok = await POST(`/approval/Approvals(${id})/ApprovalService.reject`, { comment: 'Missing detail' }, { auth: MGR });
  assert.ok(ok.status < 400, `reject ${ok.status}`);
  assert.equal((await GET(`/expense/MyClaims${active(id)}`, { auth: EMP })).data.status, 'Rejected');
});

test('RBAC: employee-only user blocked from /approval data (403); metadata still loads', async () => {
  assert.equal((await GET('/approval/$metadata', { auth: CLERK })).status, 200, 'metadata should load');
  assert.equal((await GET('/approval/Approvals', { auth: CLERK })).status, 403, 'employee blocked from approvals');
  assert.equal((await GET('/approval/Approvals', { auth: MGR })).status, 200, 'approver can read approvals');
});

test('Policy config: read, edit (draft), and audit; non-admin blocked', async () => {
  // read
  const list = await GET('/approval/Policies', { auth: MGR });
  assert.equal(list.status, 200);
  const id = list.data.value[0].ID;
  // employee-only cannot read policies
  assert.equal((await GET('/approval/Policies', { auth: CLERK })).status, 403);
  // draft edit: edit → patch → activate
  await POST(`/approval/Policies(ID=${id},IsActiveEntity=true)/ApprovalService.draftEdit`, { PreserveChanges: false }, { auth: MGR });
  await t.axios.patch(`/approval/Policies(ID=${id},IsActiveEntity=false)`, { gstRate: 0.20 }, { auth: MGR });
  const act = await POST(`/approval/Policies(ID=${id},IsActiveEntity=false)/draftActivate`, {}, { auth: MGR });
  assert.ok(act.status < 400, `policy activate ${act.status}: ${JSON.stringify(act.data?.error)}`);
  assert.equal(Number((await GET(`/approval/Policies(ID=${id},IsActiveEntity=true)`, { auth: MGR })).data.gstRate), 0.20);
  const logs = await GET(`/approval/AuditLogs?$filter=action eq 'PolicyChanged'`, { auth: MGR });
  assert.ok(logs.data.value.length > 0, 'policy change audited');
});

test('Workflow members: UK has 2 approvers, India has 1', async () => {
  const wf = await GET('/approval/WorkflowMembers', { auth: MGR });
  assert.equal(wf.status, 200);
  const uk = wf.data.value.find((w) => w.country === 'UK');
  const ind = wf.data.value.find((w) => w.country === 'IN');
  assert.ok(uk.firstApprover && uk.secondApprover, 'UK has L1 + L2');
  assert.ok(ind.firstApprover && !ind.secondApprover, 'India has L1 only');
});

test('audit: submitting a claim writes a Submitted entry', async () => {
  await submitUK();
  const logs = await GET(`/approval/AuditLogs?$filter=action eq 'Submitted'`, { auth: MGR });
  assert.ok(logs.data.value.length > 0, 'submit audited');
});
