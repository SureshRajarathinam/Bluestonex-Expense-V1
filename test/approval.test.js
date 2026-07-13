const cds = require('@sap/cds');
const test = require('node:test');
const assert = require('node:assert/strict');

const EMP = { username: 'sabarinathan.chandrasekar@bluestonex.com', password: 'sab' };
const MGR = { username: 'manager@bluestonex.com', password: 'mgr' };
const FIN = { username: 'Dan.Barton@bluestonex.com', password: 'dan' };
const IN1 = { username: 'suresh.rajarathinam@bluestonex.com', password: 'suresh' }; // India L1 (from EXP-WORKFLOW config)
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

test('reject requires a reason (422) then returns the claim for rework (Returned)', async () => {
  const id = await submitUK();
  const noReason = await POST(`/approval/Approvals(${id})/ApprovalService.reject`, { comment: '' }, { auth: MGR });
  assert.equal(noReason.status, 422, `got ${noReason.status}`);
  const mark = MAILS.length;
  const ok = await POST(`/approval/Approvals(${id})/ApprovalService.reject`, { comment: 'Missing detail' }, { auth: MGR });
  assert.ok(ok.status < 400, `reject ${ok.status}`);
  // A decline now returns the claim to the employee (reworkable), not a terminal Rejected.
  const claim = (await GET(`/expense/MyClaims${active(id)}`, { auth: EMP })).data;
  assert.equal(claim.status, 'Returned');
  assert.equal(claim.rejectedBy, 'manager@bluestonex.com', 'records who returned it');
  assert.equal(claim.rejectionReason, 'Missing detail', 'records the reason');
  // Rejection MUST email the employee who created the claim (requirement). The
  // recipient is the authoritative directory email or, unresolved, the createdBy login.
  const returnedMail = mailsSince(mark).find((mm) => /returned for rework/i.test(mm.subject || ''));
  assert.ok(returnedMail, 'reject sends a "returned for rework" email to the employee');
  assert.ok(
    /bluestonex\.com$/i.test(String(returnedMail.to || '')),
    `email addressed to the employee, got "${returnedMail.to}"`
  );
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

test('daily-limit breach is SOFT: the claim still submits and carries a policyFlag for the approver', async () => {
  // Two same-day UK hotel lines totalling £260 > UK hotel daily limit (200).
  const c = await POST('/expense/MyClaims', { country: 'UK', claimPeriod: '2026-02-28' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', reasonForTrip: 'N1', vatType: 'STD', grossAmount: 130, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', reasonForTrip: 'N2', vatType: 'STD', grossAmount: 130, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  const s = await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  assert.ok(s.status < 400, `over-limit claim should still submit (soft flag), got ${s.status}: ${JSON.stringify(s.data?.error)}`);
  // The approver sees the flag on the claim.
  const apv = await GET(`/approval/Approvals(${id})`, { auth: MGR });
  assert.ok(apv.data.policyFlags && /daily limit/i.test(apv.data.policyFlags), `policyFlags should be set: ${JSON.stringify(apv.data.policyFlags)}`);
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
  const a1 = await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'ok' }, { auth: IN1 });
  assert.ok(a1.status < 400, `first approve ${a1.status}`);
  // second approve attempt — claim is Approved (out of pending queue) → must not succeed
  const a2 = await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'again' }, { auth: IN1 });
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
  // Submit MUST email the configured first-level approver (L1 mail mechanism).
  const mSubmit = MAILS.length;
  const id = await submitUK();
  const l1mail = mailsSince(mSubmit).find((mm) => /awaiting your approval/i.test(mm.subject || ''));
  assert.ok(l1mail, 'submit emails the L1 approver');
  assert.equal(String(l1mail.to || '').toLowerCase(), 'manager@bluestonex.com', 'L1 email addressed to the configured first approver');

  const before = NOTIFS.length;
  const mApprove = MAILS.length;
  const ok = await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'ok' }, { auth: MGR });
  assert.ok(ok.status < 400, `L1 approve ${ok.status}`);
  const evts = eventsFor(id, 'ExpenseClaim.Level1Approved');
  assert.equal(evts.length, 1, 'exactly one Level1Approved event should fire for a UK claim');
  // The payload must carry the configured second-level approver so ANS can route it.
  assert.ok(JSON.stringify(evts[0]).includes('Dan.Barton@bluestonex.com'),
    'the event should reference the UK second-level approver');
  assert.ok(NOTIFS.length > before, 'a notification was recorded');
  // UK L1 approval MUST email the configured second-level approver (L2 mail mechanism).
  const l2mail = mailsSince(mApprove).find((mm) => /second-level approval/i.test(mm.subject || ''));
  assert.ok(l2mail, 'UK L1 approval emails the L2 approver');
  assert.equal(String(l2mail.to || '').toLowerCase(), 'dan.barton@bluestonex.com', 'L2 email addressed to the configured second approver');
});

test('India single-level approval does NOT fire a second-approver notification', async () => {
  const c = await POST('/expense/MyClaims', { country: 'IN', claimPeriod: '2026-02-28' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', reasonForTrip: 'T', vatType: 'STD', grossAmount: 118, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  const mApprove = MAILS.length;
  const ok = await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'ok' }, { auth: IN1 });
  assert.ok(ok.status < 400, `IN approve ${ok.status}`);
  assert.equal(eventsFor(id, 'ExpenseClaim.Level1Approved').length, 0,
    'India (single-level) approval must not fire a Level1Approved event');
  // India is single-level → the L1 approval must NOT email any second-level approver.
  assert.ok(!mailsSince(mApprove).some((mm) => /second-level/i.test(mm.subject || '')),
    'India approval sends no second-level email');
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
  assert.ok(mails.some((m) => m.to === 'suresh.rajarathinam@bluestonex.com'),
    'India single-level approver (suresh.rajarathinam@) should be emailed on submit');
});

test('India single-level approval sends no further approver email', async () => {
  const c = await POST('/expense/MyClaims', { country: 'IN', claimPeriod: '2026-02-28' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', reasonForTrip: 'T', vatType: 'STD', grossAmount: 118, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  const before = MAILS.length;
  const ok = await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'ok' }, { auth: IN1 });
  assert.ok(ok.status < 400, `IN approve ${ok.status}`);
  assert.equal(mailsSince(before).length, 0,
    'India (single-level) approval must not send a second-level email');
});

// Regression: HANA returns DECIMAL columns as STRINGS ("20.00"), so the email
// amount formatter must coerce with Number() before toFixed. SQLite returns
// numbers and hides this, so we call the notifier directly with a string
// totalGross to reproduce the production shape. Pre-fix this threw
// "(claim.totalGross || 0).toFixed is not a function" and the approver email
// was silently dropped.
test('approver email survives a string totalGross (HANA DECIMAL shape)', async () => {
  const before = MAILS.length;
  await notification.notifyClaimSubmitted(
    { ID: 'regr-1', claimNumber: 'EXP-REGR-1', totalGross: '20.00', currency: 'INR', claimPeriod: '2026-02-28' },
    { fullName: 'Test User' },
    'suresh.rajarathinam@bluestonex.com'
  );
  const mails = mailsSince(before);
  assert.ok(mails.some((m) => m.to === 'suresh.rajarathinam@bluestonex.com' && /₹20\.00/.test(m.text)),
    'approver is emailed with a correctly formatted ₹ amount despite a string totalGross');
});

test('rework loop: return → resubmit reuses the SAME claim (no dup, one history row, resubmitCount 1)', async () => {
  const id = await submitUK();
  const noBefore = (await GET(`/expense/MyClaims${active(id)}`, { auth: EMP })).data.claimNumber;
  // Approver returns it for rework
  await POST(`/approval/Approvals(${id})/ApprovalService.reject`, { comment: 'Please attach the receipt' }, { auth: MGR });
  assert.equal((await GET(`/expense/MyClaims${active(id)}`, { auth: EMP })).data.status, 'Returned');
  // Employee reworks: Edit (draftEdit) → Save (draftActivate) → Apply for Approval (submitClaim)
  await POST(`/expense/MyClaims${active(id)}/ExpenseService.draftEdit`, { PreserveChanges: false }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  const rs = await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  assert.ok(rs.status < 400, `resubmit ${rs.status}: ${JSON.stringify(rs.data?.error)}`);
  assert.equal(rs.data.status, 'Submitted', 'resubmitted claim is Submitted again');
  // Same record + same number → no duplicate claim was created
  assert.equal((await GET(`/expense/MyClaims${active(id)}`, { auth: EMP })).data.claimNumber, noBefore, 'claim number unchanged');
  // Approve to completion (UK 2-level)
  await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'ok' }, { auth: MGR });
  await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'ok' }, { auth: FIN });
  assert.equal((await GET(`/expense/MyClaims${active(id)}`, { auth: EMP })).data.status, 'Approved');
  // Exactly one history row for this claim number; resubmitCount reflects the one rework.
  const hist = await GET(`/approval/ClaimHistory?$filter=claimNumber eq '${noBefore}'`, { auth: MGR });
  assert.equal(hist.data.value.length, 1, 'one history row (no duplicate)');
  assert.equal(hist.data.value[0].resubmitCount, 1, 'resubmitCount is 1');
});

test('claimJourney returns the ordered trail, assigned approvers and resubmit count', async () => {
  const id = await submitUK();
  const no = (await GET(`/expense/MyClaims${active(id)}`, { auth: EMP })).data.claimNumber;
  await POST(`/approval/Approvals(${id})/ApprovalService.reject`, { comment: 'fix it' }, { auth: MGR });
  await POST(`/expense/MyClaims${active(id)}/ExpenseService.draftEdit`, { PreserveChanges: false }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'ok' }, { auth: MGR });
  await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'ok' }, { auth: FIN });

  const j = await GET(`/approval/claimJourney(claimNumber='${no}')`, { auth: MGR });
  assert.equal(j.status, 200, `journey ${j.status}: ${JSON.stringify(j.data?.error)}`);
  const d = j.data;
  assert.equal(d.assignedL1, 'manager@bluestonex.com', 'assigned L1 from workflow');
  assert.equal(d.assignedL2, 'Dan.Barton@bluestonex.com', 'assigned L2 from workflow');
  assert.equal(d.approvedL1By, 'manager@bluestonex.com');
  assert.equal(d.approvedL2By, 'Dan.Barton@bluestonex.com');
  assert.equal(d.resubmitCount, 1);
  assert.deepEqual(d.events.map((e) => e.action),
    ['Submitted', 'Returned', 'Resubmitted', 'FirstApproved', 'Approved'],
    'the timeline is ordered and distinguishes Resubmitted');
  // employee-only cannot read the journey
  assert.equal((await GET(`/approval/claimJourney(claimNumber='${no}')`, { auth: CLERK })).status, 403);
});

test('ClaimHistory batch-enriches attachmentCount (receipts) and resubmitCount', async () => {
  const c = await POST('/expense/MyClaims', { country: 'UK', claimPeriod: '2026-02-28' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', reasonForTrip: 'T', vatType: 'STD', grossAmount: 120, receiptAttached: true, receiptFileName: 'hotel.pdf' }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  const hist = await GET(`/approval/ClaimHistory(${id})`, { auth: MGR });
  assert.equal(hist.status, 200, `history read ${hist.status}`);
  assert.equal(hist.data.attachmentCount, 1, 'one item has a receipt file → attachmentCount 1');
  assert.equal(hist.data.resubmitCount, 0, 'never resubmitted → 0');
});

test('PDF export: approver gets a PDF (base64), employee-only is 403', async () => {
  const url = "/approval/exportClaimsPdf(scope='history',status=null,country=null,claimNo=null,fromDate=null,toDate=null)";
  const ok = await GET(url, { auth: MGR });
  assert.ok(ok.status < 400, `pdf export ${ok.status}: ${JSON.stringify(ok.data?.error || '')}`);
  const buf = Buffer.from((ok.data && ok.data.value) || '', 'base64');
  assert.equal(buf.slice(0, 5).toString(), '%PDF-', 'decoded body should be a PDF');
  assert.equal((await GET(url, { auth: CLERK })).status, 403, 'employee-only PDF should be 403');
});
