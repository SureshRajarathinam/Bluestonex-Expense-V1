const cds = require('@sap/cds');
const test = require('node:test');
const assert = require('node:assert/strict');

const EMP = { username: 'sabarinathan.chandrasekar@bluestonex.com', password: 'sab' };
const MGR = { username: 'manager@bluestonex.com', password: 'mgr' };
const FIN = { username: 'Dan.Barton@bluestonex.com', password: 'dan' };
const CLERK = { username: 'clerk@bluestonex.com', password: 'clerk' }; // Employee only

// Spy on the notification singleton's low-level sender to capture every ANS
// event the real methods emit (ANS is unconfigured in tests, so _sendEvent is a
// no-op we simply record). Same module instance the services use — reassigning
// _sendEvent is visible to notifyClaimSubmitted/notifyLevel1Approved via `this`.
const notification = require('../srv/notification');
const NOTIFS = [];
const _origSend = notification._sendEvent.bind(notification);
notification._sendEvent = async (payload) => { NOTIFS.push(payload); return _origSend(payload); };
const eventsFor = (id, type) => NOTIFS.filter((e) => e.resource?.resourceInstance === id && e.eventType === type);

// Spy on the mailer singleton the notification layer uses, so we can assert the
// approval alert is addressed to the approver configured in Approval Workflow.
// Same instance require('../srv/lib/mailer') returns to notification.js.
const mailer = require('../srv/lib/mailer');
const MAILS = [];
mailer.sendMail = async (opts) => { MAILS.push(opts); return true; };
const mailsSince = (n) => MAILS.slice(n);

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
  // Per-country policies: edit the India row (it carries the GST rate).
  const inRow = list.data.value.find((p) => p.country === 'IN');
  assert.ok(inRow, 'India policy row exists');
  const id = inRow.ID;
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

test('per-country policy: India hotel above the UK limit still submits (own limit applies)', async () => {
  // A 500 hotel exceeds the UK daily limit (200) but is within India's own limit (8000),
  // proving the claim is validated against its country's policy row.
  const c = await POST('/expense/MyClaims', { country: 'IN', claimPeriod: '2026-02-28' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', reasonForTrip: 'T', vatType: 'STD', grossAmount: 500, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  const s = await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  assert.ok(s.status < 400, `India hotel 500 should submit under India policy, got ${s.status}: ${JSON.stringify(s.data?.error)}`);
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

test('cannot approve a claim twice / once completed (409 or removed from queue)', async () => {
  // India claim completes after one approval
  const c = await POST('/expense/MyClaims', { country: 'IN', claimPeriod: '2026-02-28' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', reasonForTrip: 'T', vatType: 'STD', grossAmount: 118, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  const a1 = await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'ok' }, { auth: MGR });
  assert.ok(a1.status < 400, `first approve ${a1.status}`);
  // second approve attempt — claim is Approved (out of pending queue) → must not succeed
  const a2 = await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'again' }, { auth: MGR });
  assert.ok(a2.status >= 400, `re-approving a completed claim must fail, got ${a2.status}`);
});

test('rejected claim leaves the approvals queue', async () => {
  const id = await submitUK();
  await POST(`/approval/Approvals(${id})/ApprovalService.reject`, { comment: 'No' }, { auth: MGR });
  const g = await GET(`/approval/Approvals(${id})`, { auth: MGR });
  assert.equal(g.status, 404, `rejected claim should be gone from queue, got ${g.status}`);
});

test('History: shows non-draft claims (incl. approved/rejected), excludes drafts; employee blocked', async () => {
  const id = await submitUK();
  await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'ok' }, { auth: MGR });
  const hist = await GET('/approval/ClaimHistory', { auth: MGR });
  assert.equal(hist.status, 200, `history read ${hist.status}`);
  assert.ok(hist.data.value.some((r) => r.ID === id), 'submitted/approved claim appears in history');
  assert.ok(hist.data.value.every((r) => r.status !== 'Draft'), 'no drafts in history');
  // a pure draft must not surface in history
  const dft = await POST('/expense/MyClaims', { country: 'UK', claimPeriod: '2026-03-01' }, { auth: EMP });
  const h2 = await GET('/approval/ClaimHistory', { auth: MGR });
  assert.ok(!h2.data.value.some((r) => r.ID === dft.data.ID), 'draft excluded from history');
  // employee-only blocked
  assert.equal((await GET('/approval/ClaimHistory', { auth: CLERK })).status, 403, 'employee blocked from history');
});

test('UK level-1 approval fires a notification to the second-level approver', async () => {
  const id = await submitUK();
  const before = NOTIFS.length;
  const ok = await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'ok' }, { auth: MGR });
  assert.ok(ok.status < 400, `L1 approve ${ok.status}`);
  const evts = eventsFor(id, 'ExpenseClaim.Level1Approved');
  assert.equal(evts.length, 1, 'exactly one Level1Approved event should fire for a UK claim');
  // The payload must carry the configured second-level approver so ANS can route it.
  assert.ok(JSON.stringify(evts[0]).includes('Dan.Barton@bluestonex.com'),
    'the event should reference the UK second-level approver');
  assert.ok(NOTIFS.length > before, 'a notification was recorded');
});

test('India single-level approval does NOT fire a second-approver notification', async () => {
  const c = await POST('/expense/MyClaims', { country: 'IN', claimPeriod: '2026-02-28' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', reasonForTrip: 'T', vatType: 'STD', grossAmount: 118, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  const ok = await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'ok' }, { auth: MGR });
  assert.ok(ok.status < 400, `IN approve ${ok.status}`);
  assert.equal(eventsFor(id, 'ExpenseClaim.Level1Approved').length, 0,
    'India (single-level) approval must not fire a Level1Approved event');
});

test('server computes item net/VAT split on save (UK 20%: gross 120 → net 100, VAT 20)', async () => {
  // Regression guard: the my-expenses UI shows a client-side net/VAT preview, but
  // before('SAVE') stays the source of truth for the persisted values.
  const c = await POST('/expense/MyClaims', { country: 'UK', claimPeriod: '2026-02-28' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', reasonForTrip: 'T', vatType: 'STD', grossAmount: 120, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  const items = await GET(`/expense/MyClaims${active(id)}/items`, { auth: EMP });
  const it = items.data.value[0];
  assert.equal(Number(it.netAmount), 100, 'net should be gross / 1.20');
  assert.equal(Number(it.vatAmount), 20, 'VAT should be gross - net');
});

test('submitting a UK claim emails the configured first-level approver', async () => {
  const before = MAILS.length;
  const c = await POST('/expense/MyClaims', { country: 'UK', claimPeriod: '2026-02-28' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', reasonForTrip: 'T', vatType: 'STD', grossAmount: 120, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  const s = await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  assert.ok(s.status < 400, `submit ${s.status}`);
  const mails = mailsSince(before);
  assert.ok(mails.some((m) => m.to === 'manager@bluestonex.com'),
    'UK first-level approver (manager@) should be emailed on submit');
});

test('UK level-1 approval emails the configured second-level approver', async () => {
  const id = await submitUK();
  const before = MAILS.length;
  const ok = await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'ok' }, { auth: MGR });
  assert.ok(ok.status < 400, `L1 approve ${ok.status}`);
  const mails = mailsSince(before);
  assert.ok(mails.some((m) => m.to === 'Dan.Barton@bluestonex.com'),
    'UK second-level approver (Dan.Barton@) should be emailed on level-1 approval');
});

test('submitting an India claim emails the single configured approver', async () => {
  const before = MAILS.length;
  const c = await POST('/expense/MyClaims', { country: 'IN', claimPeriod: '2026-02-28' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', reasonForTrip: 'T', vatType: 'STD', grossAmount: 118, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  const mails = mailsSince(before);
  assert.ok(mails.some((m) => m.to === 'manager@bluestonex.com'),
    'India single-level approver (manager@) should be emailed on submit');
});

test('India single-level approval sends no further approver email', async () => {
  const c = await POST('/expense/MyClaims', { country: 'IN', claimPeriod: '2026-02-28' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', reasonForTrip: 'T', vatType: 'STD', grossAmount: 118, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  const before = MAILS.length;
  const ok = await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'ok' }, { auth: MGR });
  assert.ok(ok.status < 400, `IN approve ${ok.status}`);
  assert.equal(mailsSince(before).length, 0,
    'India (single-level) approval must not send a second-level email');
});

test('PDF export: approver gets a PDF (base64), employee-only is 403', async () => {
  const url = "/approval/exportClaimsPdf(scope='history',status=null,country=null,claimNo=null,fromDate=null,toDate=null)";
  const ok = await GET(url, { auth: MGR });
  assert.ok(ok.status < 400, `pdf export ${ok.status}: ${JSON.stringify(ok.data?.error || '')}`);
  const buf = Buffer.from((ok.data && ok.data.value) || '', 'base64');
  assert.equal(buf.slice(0, 5).toString(), '%PDF-', 'decoded body should be a PDF');
  assert.equal((await GET(url, { auth: CLERK })).status, 403, 'employee-only PDF should be 403');
});
