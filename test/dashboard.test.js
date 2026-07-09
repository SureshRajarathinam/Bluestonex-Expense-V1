// ─────────────────────────────────────────────────────────────────────────────
//  ApprovalService.dashboardStats — analytics aggregation for the Dashboard tab.
//
//  Seeds a few approved/rejected claims across UK + India (incl. one by a
//  non-seeded owner → the "Unassigned" team bucket), then asserts the aggregation,
//  the date-range + country filters, currency separation, and the Approver/Admin
//  role gate. Runs on the cds.test in-memory harness (fresh DB per file).
// ─────────────────────────────────────────────────────────────────────────────
const cds = require('@sap/cds');
const test = require('node:test');
const assert = require('node:assert/strict');

const EMP   = { username: 'sabarinathan.chandrasekar@bluestonex.com', password: 'sab' }; // seeded emp, dept Operations
const MGR   = { username: 'manager@bluestonex.com', password: 'mgr' };                   // UK L1
const FIN   = { username: 'Dan.Barton@bluestonex.com', password: 'dan' };                // UK L2
const YUV   = { username: 'yuvaraj.kumar@bluestonex.com', password: 'yuvaraj' };         // IN L1
const CLERK = { username: 'clerk@bluestonex.com', password: 'clerk' };                   // Employee only, NOT seeded emp
const PRIYA = { username: 'priya.sharma@bluestonex.com', password: 'priya' };            // Employee only

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
const stats = (from, to, country) =>
  `/approval/dashboardStats(fromDate=${from},toDate=${to},country='${country}')`;

async function mkApprovedOrRejected(auth, country, gross) {
  const c = await POST('/expense/MyClaims', { country, claimPeriod: '2026-02-28' }, { auth });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', reasonForTrip: 'T', vatType: 'STD', grossAmount: gross, receiptAttached: true }, { auth });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth });
  const s = await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth });
  assert.ok(s.status < 400, `seed submit failed (${auth.username}): ${s.status} ${JSON.stringify(s.data?.error)}`);
  return id;
}
const approveUK = async (id) => {
  await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'ok' }, { auth: MGR });
  await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'ok' }, { auth: FIN });
};
const approveIN = (id) => POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'ok' }, { auth: YUV });
const reject = (id) => POST(`/approval/Approvals(${id})/ApprovalService.reject`, { comment: 'no' }, { auth: MGR });

test('seed claims then dashboardStats aggregates correctly (ALL)', async () => {
  await approveUK(await mkApprovedOrRejected(EMP, 'UK', 120));    // UK approved · team Operations · £120
  await approveUK(await mkApprovedOrRejected(CLERK, 'UK', 180));  // UK approved · team Unassigned · £180 (≤ £200 hotel limit)
  await approveIN(await mkApprovedOrRejected(EMP, 'IN', 118));    // IN approved · ₹118
  await reject(await mkApprovedOrRejected(EMP, 'UK', 60));        // UK rejected

  const r = await GET(stats('2020-01-01', '2030-12-31', 'ALL'), { auth: MGR });
  assert.equal(r.status, 200, `dashboardStats ${r.status}: ${JSON.stringify(r.data?.error)}`);
  const d = r.data;

  assert.equal(d.approved.total, 3, 'approved total');
  assert.equal(d.approved.UK, 2);
  assert.equal(d.approved.IN, 1);
  assert.equal(d.rejected.total, 1, 'rejected total');
  assert.equal(d.rejected.UK, 1);

  // Currency-separated reimbursed (approved): UK £300, India ₹118 — never combined.
  assert.equal(Number(d.reimbursed.gbp), 300);
  assert.equal(Number(d.reimbursed.inr), 118);

  // Spend by category — HOTEL present with UK spend in gbp.
  const hotel = d.spendByCategory.find((c) => c.code === 'HOTEL');
  assert.ok(hotel && Number(hotel.gbp) === 300, 'HOTEL category gbp');

  // Spend by team — the clerk (non-seeded) claim lands in the Unassigned bucket.
  assert.ok(d.spendByTeam.some((t) => t.department === 'Unassigned'), 'Unassigned team bucket');
  assert.ok(d.spendByTeam.some((t) => t.department === 'Operations'), 'seeded dept bucket');

  assert.ok(Array.isArray(d.trend) && d.trend.length >= 1, 'trend has months');
});

test('country filter scopes every figure (IN only)', async () => {
  const r = await GET(stats('2020-01-01', '2030-12-31', 'IN'), { auth: MGR });
  assert.equal(r.status, 200);
  assert.equal(r.data.approved.UK, 0, 'no UK when filtered to India');
  assert.ok(r.data.approved.IN >= 1);
  assert.equal(Number(r.data.reimbursed.gbp), 0, 'no £ when filtered to India');
  assert.ok(Number(r.data.reimbursed.inr) >= 118);
});

test('date range excludes out-of-window claims', async () => {
  const r = await GET(stats('2020-01-01', '2020-12-31', 'ALL'), { auth: MGR });
  assert.equal(r.status, 200);
  assert.equal(r.data.approved.total, 0, 'nothing approved in 2020');
  assert.equal(r.data.trend.length, 0, 'no trend months in 2020');
});

test('dashboardStats is Approver/Admin-only (403 for employee-only users)', async () => {
  assert.equal((await GET(stats('2020-01-01', '2030-12-31', 'ALL'), { auth: CLERK })).status, 403);
  assert.equal((await GET(stats('2020-01-01', '2030-12-31', 'ALL'), { auth: PRIYA })).status, 403);
});
