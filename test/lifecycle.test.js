const cds = require('@sap/cds');
const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../srv/lib/calc');

const EMP = { username: 'sabarinathan.chandrasekar@bluestonex.com', password: 'sab' }; // employee (not an approver in workflow)
const MGR = { username: 'manager@bluestonex.com', password: 'mgr' };                   // UK L1 + India L1
const FIN = { username: 'Dan.Barton@bluestonex.com', password: 'dan' };                // UK L2
const near = (a, b) => Math.abs(a - b) < 0.01;

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
const statusOf = async (id) => (await GET(`/expense/MyClaims${active(id)}`, { auth: EMP })).data.status;

// Helper: create + populate + submit a claim for a given country; returns ID.
async function submitClaim(country, gross = 120) {
  const c = await POST('/expense/MyClaims', { country, claimPeriod: '2026-02-28' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', destination: 'X', reasonForTrip: 'Trip', vatType: 'STD', grossAmount: gross, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  const s = await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  assert.ok(s.status < 400, `submit ${country} ${s.status}: ${JSON.stringify(s.data?.error)}`);
  return id;
}

test('A. tax math: UK VAT 20% vs India GST 18%', () => {
  const uk = calc.splitVAT(120, 'STD', calc.taxRateFor('UK', { vatRate: 0.20 }));
  assert.ok(near(uk.netAmount, 100) && near(uk.vatAmount, 20), `UK ${JSON.stringify(uk)}`);
  const ind = calc.splitVAT(118, 'STD', calc.taxRateFor('IN', { gstRate: 0.18 }));
  assert.ok(near(ind.netAmount, 100) && near(ind.vatAmount, 18), `IN ${JSON.stringify(ind)}`);
});

test('B. country-aware tax persists on SAVE (UK=20%, India=18%)', async () => {
  const ukC = await POST('/expense/MyClaims', { country: 'UK', claimPeriod: '2026-02-28' }, { auth: EMP });
  const ukId = ukC.data.ID;
  await POST(`/expense/MyClaims${draft(ukId)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', reasonForTrip: 'T', vatType: 'STD', grossAmount: 120, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(ukId)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  const uk = (await GET(`/expense/MyClaims${active(ukId)}`, { auth: EMP })).data;
  assert.ok(near(uk.totalVAT, 20) && uk.currency === 'GBP', `UK totalVAT=${uk.totalVAT} cur=${uk.currency}`);

  const inC = await POST('/expense/MyClaims', { country: 'IN', claimPeriod: '2026-02-28' }, { auth: EMP });
  const inId = inC.data.ID;
  await POST(`/expense/MyClaims${draft(inId)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', reasonForTrip: 'T', vatType: 'STD', grossAmount: 118, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(inId)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  const ind = (await GET(`/expense/MyClaims${active(inId)}`, { auth: EMP })).data;
  assert.ok(near(ind.totalVAT, 18) && ind.currency === 'INR', `IN totalVAT=${ind.totalVAT} cur=${ind.currency}`);
});

test('C. UK = TWO-level approval (L1 then L2 → Approved)', async () => {
  const id = await submitClaim('UK');
  assert.equal(await statusOf(id), 'Submitted');
  // L1 = manager
  const a1 = await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'L1 ok' }, { auth: MGR });
  assert.ok(a1.status < 400, `L1 ${a1.status}: ${JSON.stringify(a1.data?.error)}`);
  assert.equal(await statusOf(id), 'FirstApproved');
  // L2 = Dan
  const a2 = await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'L2 ok' }, { auth: FIN });
  assert.ok(a2.status < 400, `L2 ${a2.status}: ${JSON.stringify(a2.data?.error)}`);
  assert.equal(await statusOf(id), 'Approved');
});

test('D. India = SINGLE-level approval (L1 → Approved)', async () => {
  const id = await submitClaim('IN', 118);
  assert.equal(await statusOf(id), 'Submitted');
  const a = await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'ok' }, { auth: MGR });
  assert.ok(a.status < 400, `IN approve ${a.status}: ${JSON.stringify(a.data?.error)}`);
  assert.equal(await statusOf(id), 'Approved'); // single level completes it
});

test('E. a claim without a country cannot be activated or submitted', async () => {
  const c = await POST('/expense/MyClaims', { claimPeriod: '2026-03-01' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'TOLLS', reasonForTrip: 'T', vatType: 'STD', grossAmount: 5 }, { auth: EMP });
  // country is @mandatory → activation is blocked; if it somehow activates, submit guards it (422)
  const act = await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  let blocked = act.status >= 400;
  if (!blocked) {
    const s = await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
    blocked = s.status === 422;
  }
  assert.ok(blocked, 'a claim with no country must not be submittable');
});
