const cds = require('@sap/cds');
const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../srv/lib/calc');

const EMP_SAB = 'f1a2b3c4-0001-0001-0001-000000000001';
const EMP = { username: 'sabarinathan.chandrasekar@bluestonex.com', password: 'sab' };
const MGR = { username: 'manager@bluestonex.com', password: 'mgr' };
const FIN = { username: 'Dan.Barton@bluestonex.com', password: 'dan' };
const EMP_ONLY = { username: 'clerk@bluestonex.com', password: 'clerk' }; // Employee role only (RBAC test)
const near = (a, b) => Math.abs(a - b) < 0.01;

const t = cds.test(process.cwd());
t.axios.defaults.validateStatus = () => true;
const POST = (u, d, c) => t.axios.post(u, d, c);
const GET  = (u, c) => t.axios.get(u, c);
const active = (id) => `(ID=${id},IsActiveEntity=true)`;
const draft  = (id) => `(ID=${id},IsActiveEntity=false)`;

test('A. calculation math (pure)', () => {
  const h = calc.splitVAT(119, 'STD');
  assert.ok(near(h.netAmount, 99.17) && near(h.vatAmount, 19.83), `hotel ${JSON.stringify(h)}`);
  const z = calc.splitVAT(50, 'ZR');
  assert.ok(near(z.netAmount, 50) && near(z.vatAmount, 0), 'zero-rated');
  assert.ok(near(calc.mileageTotal(359.5, 0.25), 89.88), 'mileage');
  const tot = calc.claimTotals(
    [{ grossAmount: 119, netAmount: 99.17, vatAmount: 19.83 }, { grossAmount: 175.25, netAmount: 146.04, vatAmount: 29.21 }],
    [{ totalAmount: 89.88 }]
  );
  assert.ok(near(tot.totalGross, 384.13) && near(tot.totalVAT, 49.04) && near(tot.totalNet, 335.09), `totals ${JSON.stringify(tot)}`);
});

let claimId;

test('B. employee draft → items → activate computes totals on SAVE', async () => {
  const c = await POST('/expense/MyClaims', { employee_ID: EMP_SAB, payrollArea: 'GB - Central', claimPeriod: '2026-02-28' }, { auth: EMP });
  assert.ok(c.status < 400, `create draft ${c.status}: ${JSON.stringify(c.data?.error)}`);
  claimId = c.data.ID;
  assert.equal(c.data.IsActiveEntity, false, 'should be a draft');

  const dk = draft(claimId);
  await POST(`/expense/MyClaims${dk}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', destination: 'Narborough', reasonForTrip: 'WoS - Office', vatType: 'STD', grossAmount: 119, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${dk}/items`, { expenseDate: '2026-02-25', expenseType_code: 'TRAIN', reasonForTrip: 'WoS - Office', vatType: 'STD', grossAmount: 175.25, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${dk}/mileageClaims`, { tripDate: '2026-02-16', destination: 'Narborough', reasonForTrip: 'WoS - Office', engineType: 'Petrol', milesCount: 359.5, ratePerMile: 0.25 }, { auth: EMP });

  const act = await POST(`/expense/MyClaims${dk}/ExpenseService.draftActivate`, {}, { auth: EMP });
  assert.ok(act.status < 400, `draftActivate ${act.status}: ${JSON.stringify(act.data?.error)}`);

  const r = await GET(`/expense/MyClaims${active(claimId)}?$expand=items,mileageClaims`, { auth: EMP });
  const claim = r.data;
  assert.ok(claim.claimNumber, 'claimNumber assigned on SAVE');
  assert.ok(near(claim.totalGross, 384.13), `totalGross ${claim.totalGross} (exp ~384.13)`);
  assert.ok(near(claim.totalVAT, 49.04), `totalVAT ${claim.totalVAT}`);
  assert.ok(near(claim.totalNet, 335.09), `totalNet ${claim.totalNet}`);
  const hotel = claim.items.find((x) => x.expenseType_code === 'HOTEL');
  assert.ok(near(hotel.netAmount, 99.17) && near(hotel.vatAmount, 19.83), `item split ${JSON.stringify(hotel)}`);
});

test('B2. submit → Submitted', async () => {
  const s = await POST(`/expense/MyClaims${active(claimId)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  assert.ok(s.status < 400, `submit ${s.status}: ${JSON.stringify(s.data?.error)}`);
  assert.equal(s.data.status, 'Submitted');
});

test('C. manager approves → ManagerApproved', async () => {
  const a = await POST(`/approval/TeamClaims(${claimId})/ApprovalService.approveClaim`, { comment: 'Approved by manager' }, { auth: MGR });
  assert.ok(a.status < 400, `approve ${a.status}: ${JSON.stringify(a.data?.error)}`);
  assert.equal(a.data.status, 'ManagerApproved');
});

test('D. finance approves & settles', async () => {
  const fa = await POST(`/finance/FinanceClaims(${claimId})/FinanceService.financeApprove`, { comment: 'Finance OK' }, { auth: FIN });
  assert.ok(fa.status < 400, `financeApprove ${fa.status}: ${JSON.stringify(fa.data?.error)}`);
  assert.equal(fa.data.status, 'FinanceApproved');
  const st = await POST(`/finance/FinanceClaims(${claimId})/FinanceService.settleClaim`, {}, { auth: FIN });
  assert.ok(st.status < 400, `settle ${st.status}: ${JSON.stringify(st.data?.error)}`);
  assert.equal(st.data.status, 'Settled');
});

test('E1. cannot submit a £0 claim (422)', async () => {
  const c = await POST('/expense/MyClaims', { employee_ID: EMP_SAB, claimPeriod: '2026-03-01' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  const s = await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  assert.equal(s.status, 422, `got ${s.status}: ${JSON.stringify(s.data?.error?.message)}`);
});

test('E2. cannot approve an already-settled claim (409)', async () => {
  const r = await POST(`/approval/TeamClaims(${claimId})/ApprovalService.approveClaim`, { comment: 'x' }, { auth: MGR });
  assert.equal(r.status, 409, `got ${r.status}`);
});

test('E3. /approval metadata loads for any user (app renders) but data is role-gated', async () => {
  // $metadata must be readable by any authenticated user, else the Fiori app goes blank
  const meta = await GET('/approval/$metadata', { auth: EMP });
  assert.equal(meta.status, 200, `metadata should load, got ${meta.status}`);
  // ...but the actual claim data is still restricted to the Manager role
  const data = await GET('/approval/TeamClaims', { auth: EMP_ONLY });
  assert.equal(data.status, 403, `employee-only data read should be 403, got ${data.status}`);
  // ...and a user with the Manager role can read it
  const mgr = await GET('/approval/TeamClaims', { auth: MGR });
  assert.equal(mgr.status, 200, `manager data read should be 200, got ${mgr.status}`);
});

test('G. served $metadata includes Fiori UI annotations (prevents blank app)', async () => {
  for (const [path, auth] of [['/expense', EMP], ['/approval', MGR], ['/finance', FIN]]) {
    const r = await GET(`${path}/$metadata`, { auth });
    const xml = r.data || '';
    assert.equal(r.status, 200, `${path} metadata status ${r.status}`);
    assert.ok(xml.includes('LineItem'), `${path} metadata missing UI.LineItem`);
    assert.ok(xml.includes('HeaderInfo'), `${path} metadata missing UI.HeaderInfo`);
    assert.ok(xml.includes('Facets'), `${path} metadata missing UI.Facets`);
  }
});

test('H. submit blocked end-to-end when receipt missing above threshold (422)', async () => {
  const c = await POST('/expense/MyClaims', { claimPeriod: '2026-03-20' }, { auth: EMP });
  const id = c.data.ID;
  // £50 taxi, no receipt → must block submission
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-03-10', expenseType_code: 'TAXI', reasonForTrip: 'Client', vatType: 'STD', grossAmount: 50, receiptAttached: false }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  const s = await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  assert.equal(s.status, 422, `expected block, got ${s.status}`);
  assert.ok(JSON.stringify(s.data?.error).toLowerCase().includes('receipt'), 'error should mention receipt');
});

test('I. receipt upload (per item) downloads back and unblocks submission', async () => {
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const c = await POST('/expense/MyClaims', { claimPeriod: '2026-04-01' }, { auth: EMP });
  const id = c.data.ID;
  const it = await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-03-10', expenseType_code: 'TAXI', reasonForTrip: 'Client', vatType: 'STD', grossAmount: 50 }, { auth: EMP });
  const itemId = it.data.ID;
  const up = await t.axios.put(`/expense/MyClaimItems(ID=${itemId},IsActiveEntity=false)/receipt`, PNG, { headers: { 'Content-Type': 'image/png' }, auth: EMP });
  assert.ok(up.status < 400, `upload ${up.status}`);
  const dl = await t.axios.get(`/expense/MyClaimItems(ID=${itemId},IsActiveEntity=false)/receipt`, { auth: EMP, responseType: 'arraybuffer' });
  assert.equal(dl.status, 200, 'receipt downloadable');
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  const s = await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  assert.ok(s.status < 400, `submit should pass after upload, got ${s.status}: ${JSON.stringify(s.data?.error)}`);
});

test('J. full cross-app flow works with ONE all-role login (demo flow)', async () => {
  const u = EMP; // sab now has Employee+Manager+Finance
  // create + receipt + submit (My Expenses)
  const c = await POST('/expense/MyClaims', { claimPeriod: '2026-05-01' }, { auth: u });
  const id = c.data.ID;
  const it = await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-04-10', expenseType_code: 'TOLLS', reasonForTrip: 'Site visit', vatType: 'STD', grossAmount: 10 }, { auth: u });
  assert.equal(it.status, 201);
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: u });
  const s = await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: u });
  assert.ok(s.status < 400, `submit ${s.status}`);
  // it now appears in Approve Expenses for the same user (Manager role)
  const team = await GET(`/approval/TeamClaims(${id})`, { auth: u });
  assert.equal(team.status, 200, 'visible in approval');
  const ap = await POST(`/approval/TeamClaims(${id})/ApprovalService.approveClaim`, { comment: 'ok' }, { auth: u });
  assert.equal(ap.data.status, 'ManagerApproved');
  // and in Finance Expenses (Finance role): approve + settle
  const fa = await POST(`/finance/FinanceClaims(${id})/FinanceService.financeApprove`, { comment: 'ok' }, { auth: u });
  assert.equal(fa.data.status, 'FinanceApproved');
  const st = await POST(`/finance/FinanceClaims(${id})/FinanceService.settleClaim`, {}, { auth: u });
  assert.equal(st.data.status, 'Settled');
});

test('F. manager rejects with reason', async () => {
  const c = await POST('/expense/MyClaims', { employee_ID: EMP_SAB, claimPeriod: '2026-03-15' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-03-10', expenseType_code: 'TAXI', reasonForTrip: 'Client', vatType: 'STD', grossAmount: 30, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  const sub = await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  assert.ok(sub.status < 400, `submit ${sub.status}: ${JSON.stringify(sub.data?.error)}`);

  const noReason = await POST(`/approval/TeamClaims(${id})/ApprovalService.rejectClaim`, { comment: '' }, { auth: MGR });
  assert.equal(noReason.status, 422, `expected 422 got ${noReason.status}`);

  const ok = await POST(`/approval/TeamClaims(${id})/ApprovalService.rejectClaim`, { comment: 'Missing receipt' }, { auth: MGR });
  assert.ok(ok.status < 400, `reject ${ok.status}: ${JSON.stringify(ok.data?.error)}`);
  assert.equal(ok.data.status, 'Rejected');
});
