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
const { readApprovers } = require('./lib/config');

// Approver identities come from the seeded WORKFLOW config (passwords are mock-auth
// fixtures, not config, so they stay literal).
const UK = readApprovers('UK'), IN = readApprovers('IN');
const EMP   = { username: 'sabarinathan.chandrasekar@bluestonex.com', password: 'sab' }; // seeded emp, dept Operations
const MGR   = { username: UK.first,  password: 'mgr' };                                  // UK L1
const FIN   = { username: UK.second, password: 'dan' };                                  // UK L2
const IN1   = { username: IN.first,  password: 'suresh' };                                // IN L1
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
const approveIN = (id) => POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'ok' }, { auth: IN1 });
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

  // All seeded claims here are decided (approved/rejected) → nothing awaiting yet.
  assert.equal(d.awaiting.total, 0, 'nothing awaiting yet');

  // 'reimbursed' was removed from the payload (Reimbursed cards dropped).
  assert.equal(d.reimbursed, undefined, 'reimbursed removed from payload');

  // Spend by category (APPROVED only) — feeds both the bars and the Top Expense
  // Items donut. HOTEL present with approved UK spend (120+180) and approved IN spend.
  const hotel = d.spendByCategory.find((c) => c.code === 'HOTEL');
  assert.ok(hotel && Number(hotel.gbp) === 300, 'HOTEL category gbp (approved 120+180, excludes returned £60)');
  assert.equal(Number(hotel.inr), 118, 'HOTEL category inr (approved IN)');

  // expenseItems was removed — the donut now reuses approved-only spendByCategory.
  assert.equal(d.expenseItems, undefined, 'expenseItems removed from payload');

  // Spend-by-team was removed (USERS_MASTER has no department) — must not be in the payload.
  assert.equal(d.spendByTeam, undefined, 'spendByTeam removed from payload');

  // Spend by country — ISO-keyed (UK→GB), currency-separated, count fields present.
  const gb = d.spendByCountry.find((c) => c.code === 'GB');
  const inn = d.spendByCountry.find((c) => c.code === 'IN');
  assert.ok(gb && inn, 'both GB and IN geo rows present');
  assert.equal(gb.approved, 2, 'GB approved count');
  assert.equal(inn.approved, 1, 'IN approved count');
  assert.equal(Number(gb.gbp), 300, 'GB approved spend in gbp');
  assert.equal(Number(inn.inr), 118, 'IN approved spend in inr');
  assert.equal(gb.rejected, 1, 'GB rejected count');

  assert.ok(Array.isArray(d.trend) && d.trend.length >= 1, 'trend has months');
  // Per-month APPROVED gross total, currency-separated — drives the wave card.
  const feb = d.trend.find((tt) => tt.month === '2026-02');
  assert.ok(feb, 'trend has the 2026-02 bucket');
  assert.equal(Number(feb.gbp), 300, 'trend month approved gbp (120+180, excludes returned £60)');
  assert.equal(Number(feb.inr), 118, 'trend month approved inr');

  // Top 5 claimants — APPROVED (reimbursed) amount per person, sorted desc.
  assert.ok(Array.isArray(d.topClaimants) && d.topClaimants.length >= 2 && d.topClaimants.length <= 5,
    'topClaimants present (2..5)');
  const tcGbp = d.topClaimants.reduce((s, c) => s + Number(c.gbp), 0);
  const tcInr = d.topClaimants.reduce((s, c) => s + Number(c.inr), 0);
  assert.equal(tcGbp, 300, 'claimants approved gbp (120+180, excludes returned £60)');
  assert.equal(tcInr, 118, 'claimants approved inr');
  for (let i = 1; i < d.topClaimants.length; i++) {
    const prev = Number(d.topClaimants[i - 1].gbp) + Number(d.topClaimants[i - 1].inr);
    const cur = Number(d.topClaimants[i].gbp) + Number(d.topClaimants[i].inr);
    assert.ok(prev >= cur, 'topClaimants sorted descending by amount');
  }
});

test('country filter scopes every figure (IN only)', async () => {
  const r = await GET(stats('2020-01-01', '2030-12-31', 'IN'), { auth: MGR });
  assert.equal(r.status, 200);
  assert.equal(r.data.approved.UK, 0, 'no UK when filtered to India');
  assert.ok(r.data.approved.IN >= 1);
  assert.ok(r.data.spendByCategory.every((c) => Number(c.gbp) === 0), 'no £ when filtered to India');
  assert.ok(r.data.spendByCategory.some((c) => Number(c.inr) >= 118));
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

test('country filter scopes every figure (UK only)', async () => {
  const r = await GET(stats('2020-01-01', '2030-12-31', 'UK'), { auth: MGR });
  assert.equal(r.status, 200);
  assert.equal(r.data.approved.IN, 0, 'no India when filtered to UK');
  assert.ok(r.data.spendByCategory.every((c) => Number(c.inr) === 0), 'no ₹ when filtered to UK');
  assert.ok(r.data.approved.UK >= 2);
  assert.ok(r.data.spendByCategory.some((c) => Number(c.gbp) >= 300));
});

test('spendByCountry follows the country filter', async () => {
  const uk = await GET(stats('2020-01-01', '2030-12-31', 'UK'), { auth: MGR });
  assert.ok(uk.data.spendByCountry.every((c) => c.code === 'GB'), 'UK filter → only GB geo rows');
  const ind = await GET(stats('2020-01-01', '2030-12-31', 'IN'), { auth: MGR });
  assert.ok(ind.data.spendByCountry.every((c) => c.code === 'IN'), 'IN filter → only IN geo rows');
});

test('payload carries BOTH currencies per row (drives the £/₹ toggle)', async () => {
  const r = await GET(stats('2020-01-01', '2030-12-31', 'ALL'), { auth: MGR });
  const hotel = r.data.spendByCategory.find((c) => c.code === 'HOTEL');
  assert.ok(hotel, 'HOTEL present');
  assert.equal(Number(hotel.gbp), 300, 'UK hotel spend in gbp');
  assert.equal(Number(hotel.inr), 118, 'India hotel spend in inr');
});

test('unknown country returns an empty (graceful) result, not an error', async () => {
  const r = await GET(stats('2020-01-01', '2030-12-31', 'FR'), { auth: MGR });
  assert.equal(r.status, 200);
  assert.equal(r.data.approved.total, 0);
  assert.equal(r.data.spendByCategory.length, 0);
  assert.equal(r.data.trend.length, 0);
});

test('unauthenticated request is rejected (401)', async () => {
  assert.equal((await GET(stats('2020-01-01', '2030-12-31', 'ALL'))).status, 401);
});

test('awaiting counts undecided (Submitted/FirstApproved) claims', async () => {
  await mkApprovedOrRejected(EMP, 'UK', 50); // seeded, then left Submitted (undecided)
  const r = await GET(stats('2020-01-01', '2030-12-31', 'ALL'), { auth: MGR });
  assert.equal(r.status, 200);
  assert.ok(r.data.awaiting.total >= 1, 'awaiting total counts the undecided claim');
  assert.ok(r.data.awaiting.UK >= 1, 'awaiting UK counts it');
});

test('trend integrity: approved/returned never exceed submitted per month', async () => {
  const r = await GET(stats('2020-01-01', '2030-12-31', 'ALL'), { auth: MGR });
  assert.ok(r.data.trend.length >= 1);
  r.data.trend.forEach((t) => {
    assert.ok((t.approved || 0) <= (t.submitted || 0), `approved month ${t.month}`);
    assert.ok((t.rejected || 0) <= (t.submitted || 0), `returned month ${t.month}`);
  });
  // The seed includes one UK returned/rejected claim → trend carries it as `rejected`.
  const totalReturned = r.data.trend.reduce((s, t) => s + (t.rejected || 0), 0);
  assert.equal(totalReturned, 1, 'trend sums one returned claim across months');
});

test('trend buckets by the EXPENSE period (claimPeriod), not the submission month', async () => {
  // Submitted "now" (≈ test run, month 07) but with a January claimPeriod. A
  // submittedAt-based trend would bucket it in the run month; a claimPeriod-based
  // trend must place it in 2026-01.
  const c = await POST('/expense/MyClaims', { country: 'UK', claimPeriod: '2026-01-15' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-01-10', expenseType_code: 'HOTEL', reasonForTrip: 'Jan trip', vatType: 'STD', grossAmount: 120, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  const s = await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  assert.ok(s.status < 400, `Jan-period claim submit failed: ${s.status}`);
  const r = await GET(stats('2020-01-01', '2030-12-31', 'UK'), { auth: MGR });
  assert.ok(r.data.trend.some((t) => t.month === '2026-01'), `trend should carry a 2026-01 bucket: ${JSON.stringify(r.data.trend.map((t) => t.month))}`);
});

test('Policy Violation Rate: flagged claims ÷ all claims, scoped by the filters', async () => {
  // Seed a UK claim that trips a SOFT daily-limit flag: two same-day hotel lines
  // (£130 + £130 = £260) over the UK £200 hotel daily limit. It still submits and
  // carries a policyFlag → counts as a policy violation.
  const c = await POST('/expense/MyClaims', { country: 'UK', claimPeriod: '2026-05-20' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-05-10', expenseType_code: 'HOTEL', reasonForTrip: 'N1', vatType: 'STD', grossAmount: 130, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-05-10', expenseType_code: 'HOTEL', reasonForTrip: 'N2', vatType: 'STD', grossAmount: 130, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  const s = await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  assert.ok(s.status < 400, `over-limit claim should still submit (soft flag): ${s.status}`);

  const r = await GET(stats('2020-01-01', '2030-12-31', 'ALL'), { auth: MGR });
  assert.equal(r.status, 200);
  const v = r.data.violation;
  assert.ok(v, 'dashboardStats returns a violation object');
  assert.ok(v.total >= 1 && v.flagged >= 1, `flagged (${v.flagged}) and total (${v.total}) both counted`);
  assert.ok(Number(v.rate) > 0 && Number(v.rate) <= 100, `rate is a sensible percentage: ${v.rate}`);
  assert.equal(v.topBreach, 'Hotel daily limit', 'top breach parsed from the flag text');
  // The per-month flagged count feeds the sparkline.
  const may = r.data.trend.find((tt) => tt.month === '2026-05');
  assert.ok(may && may.flagged >= 1, 'the flagged claim shows in its month bucket');

  // A window with no claims → rate 0, nothing flagged (card degrades gracefully).
  const empty = await GET(stats('2019-01-01', '2019-12-31', 'ALL'), { auth: MGR });
  assert.equal(Number(empty.data.violation.rate), 0, 'empty window → 0% rate');
  assert.equal(empty.data.violation.total, 0, 'empty window → no claims');
});
