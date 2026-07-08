// ─────────────────────────────────────────────────────────────────────────────
//  Edge-case / boundary / decision-table suite
//
//  Formal techniques: equivalence partitioning + boundary-value analysis on the
//  pure calc helpers, a decision table over (country × vatType × rate), and the
//  validation boundaries that the existing suite does NOT cover (exact £25
//  receipt threshold, periodEnd<claimPeriod, at-limit meal spend).
//
//  Tests tagged "DEFECT Dx" are CHARACTERIZATION tests: they pin the CURRENT
//  (defective) behaviour so the defect is traceable and any future fix will
//  visibly flip them. Tests marked `{ todo: ... }` assert the DESIRED behaviour
//  that today's code does not yet meet (they do not fail the suite).
//  See the QA deliverable's Defect Report for D4/D5/D6.
// ─────────────────────────────────────────────────────────────────────────────
const cds = require('@sap/cds');
const test = require('node:test');
const assert = require('node:assert/strict');
const { round2, taxRateFor, splitVAT, mileageTotal, claimTotals } = require('../srv/lib/calc');
const { validateClaim } = require('../srv/lib/validate');

// ═══ PART A — UNIT: tax split decision table (calc.splitVAT) ═══════════════════
// Decision table — condition inputs → expected (net, vat):
//   country/rate | vatType | gross | net    | vat
//   UK 0.20      | STD     | 120   | 100.00 | 20.00
//   IN 0.18      | STD     | 118   | 100.00 | 18.00
//   any          | ZR      | 100   | 100.00 |  0.00
//   any          | EX      | 100   | 100.00 |  0.00
test('splitVAT: UK STD 20% — gross 120 → net 100 / vat 20', () => {
  assert.deepEqual(splitVAT(120, 'STD', 0.20), { netAmount: 100, vatAmount: 20 });
});
test('splitVAT: IN STD 18% — gross 118 → net 100 / vat 18', () => {
  assert.deepEqual(splitVAT(118, 'STD', 0.18), { netAmount: 100, vatAmount: 18 });
});
test('splitVAT: ZR zero-rated — gross 100 → net 100 / vat 0', () => {
  assert.deepEqual(splitVAT(100, 'ZR', 0.20), { netAmount: 100, vatAmount: 0 });
});
test('splitVAT: EX exempt — gross 100 → net 100 / vat 0', () => {
  assert.deepEqual(splitVAT(100, 'EX', 0.20), { netAmount: 100, vatAmount: 0 });
});

// Boundary values for gross
test('splitVAT: zero gross → {0,0}', () => {
  assert.deepEqual(splitVAT(0, 'STD', 0.20), { netAmount: 0, vatAmount: 0 });
});
test('splitVAT: null/undefined/empty gross coalesces to 0', () => {
  assert.deepEqual(splitVAT(null, 'STD', 0.20), { netAmount: 0, vatAmount: 0 });
  assert.deepEqual(splitVAT(undefined, 'STD', 0.20), { netAmount: 0, vatAmount: 0 });
  assert.deepEqual(splitVAT('', 'STD', 0.20), { netAmount: 0, vatAmount: 0 });
});
test('splitVAT: net+vat reconciles to gross across rounding (0.01 … 1,000,000.55)', () => {
  for (const g of [0.01, 0.02, 33.33, 99.99, 100, 12345.67, 1000000.55]) {
    const { netAmount, vatAmount } = splitVAT(g, 'STD', 0.20);
    assert.equal(round2(netAmount + vatAmount), round2(g), `reconcile gross ${g}`);
  }
});

// DEFECT D4 — an unknown/mistyped vatType is SILENTLY treated as zero-rated.
// 'std' (wrong case) or any bogus code yields 0 tax with no validation error.
test('splitVAT: DEFECT D4 — mistyped "std" is silently zero-rated (net=gross, vat=0)', () => {
  assert.deepEqual(splitVAT(120, 'std', 0.20), { netAmount: 120, vatAmount: 0 });
});
test('splitVAT: DEFECT D4 — unknown "BOGUS" vatType silently zero-rated', () => {
  assert.deepEqual(splitVAT(100, 'BOGUS', 0.20), { netAmount: 100, vatAmount: 0 });
});

// DEFECT D5 — negative gross passes straight through (no guard); yields negatives.
test('splitVAT: DEFECT D5 — negative gross produces negative net/vat (no guard)', () => {
  assert.deepEqual(splitVAT(-120, 'STD', 0.20), { netAmount: -100, vatAmount: -20 });
});

// ═══ PART B — UNIT: taxRateFor country resolution ═════════════════════════════
test('taxRateFor: IN uses gstRate, UK/other uses vatRate, with documented defaults', () => {
  assert.equal(taxRateFor('IN', { gstRate: 0.18 }), 0.18);
  assert.equal(taxRateFor('IN', {}), 0.18, 'IN default');
  assert.equal(taxRateFor('UK', { vatRate: 0.20 }), 0.20);
  assert.equal(taxRateFor('UK', {}), 0.20, 'UK default');
  assert.equal(taxRateFor(null, {}), 0.20, 'null country → UK default');
});
test('taxRateFor: explicit 0 rate is honoured (?? not ||)', () => {
  assert.equal(taxRateFor('IN', { gstRate: 0 }), 0, 'a genuine 0% GST must not fall back to 0.18');
  assert.equal(taxRateFor('UK', { vatRate: 0 }), 0);
});
// Characterisation: any non-'IN' country (typo, unmapped) is treated as UK.
test('taxRateFor: DEFECT-adjacent — unmapped country "FR" defaults to UK rate', () => {
  assert.equal(taxRateFor('FR', {}), 0.20);
});

// ═══ PART C — UNIT: mileageTotal + claimTotals ════════════════════════════════
test('mileageTotal: miles × rate with boundaries', () => {
  assert.equal(mileageTotal(100, 0.25), 25);
  assert.equal(mileageTotal(0, 0.25), 0);
  assert.equal(mileageTotal(null, null), 0);
});
test('mileageTotal: DEFECT D5 — negative miles pass through', () => {
  assert.equal(mileageTotal(-10, 0.25), -2.5);
});
test('claimTotals: rolls up net(incl. mileage) / vat(items only) / gross(incl. mileage)', () => {
  const totals = claimTotals(
    [{ netAmount: 100, vatAmount: 20, grossAmount: 120 }],
    [{ totalAmount: 25 }]
  );
  assert.deepEqual(totals, { totalNet: 125, totalVAT: 20, totalGross: 145 });
});
test('claimTotals: empty rows → all zero', () => {
  assert.deepEqual(claimTotals([], []), { totalNet: 0, totalVAT: 0, totalGross: 0 });
});

// ═══ PART D — UNIT: validation boundaries not covered by validate.test.js ══════
const TODAY = '2026-06-20';
const POLICY = { receiptThreshold: 25, mealDailyLimit: 40, hotelDailyLimit: 200, mileageRate: 0.25 };
const TYPES = { TOLLS: { requiresReceipt: false }, FOOD: { requiresReceipt: true }, HOTEL: { requiresReceipt: true } };
const hasErr = (r, s) => r.errors.some((e) => e.toLowerCase().includes(s.toLowerCase()));

test('rule 4 BOUNDARY: gross exactly at threshold (£25) requires a receipt (>=)', () => {
  const r = validateClaim({
    claim: { claimPeriod: '2026-02-28', totalGross: 25 },
    items: [{ expenseDate: '2026-02-16', expenseType_code: 'TOLLS', reasonForTrip: 'Toll', grossAmount: 25, receiptAttached: false }],
    mileage: [], policy: POLICY, types: TYPES, today: TODAY
  });
  assert.ok(hasErr(r, 'receipt'), '£25 == threshold must require a receipt');
});
test('rule 4 BOUNDARY: gross just below threshold (£24.99) does NOT require a receipt', () => {
  const r = validateClaim({
    claim: { claimPeriod: '2026-02-28', totalGross: 24.99 },
    items: [{ expenseDate: '2026-02-16', expenseType_code: 'TOLLS', reasonForTrip: 'Toll', grossAmount: 24.99, receiptAttached: false }],
    mileage: [], policy: POLICY, types: TYPES, today: TODAY
  });
  assert.ok(!hasErr(r, 'receipt'), '£24.99 < threshold must not require a receipt');
});
test('rule 2 header (previously untested): periodEnd before claimPeriod is an error', () => {
  const r = validateClaim({
    claim: { claimPeriod: '2026-02-28', periodEnd: '2026-02-27', totalGross: 24 },
    items: [{ expenseDate: '2026-02-16', expenseType_code: 'TOLLS', reasonForTrip: 'X', grossAmount: 24, receiptAttached: false }],
    mileage: [], policy: POLICY, types: TYPES, today: TODAY
  });
  assert.ok(hasErr(r, 'before the start') || hasErr(r, 'period end'), 'periodEnd<claimPeriod must error');
});
test('rule 5 BOUNDARY: meal spend exactly at the daily limit (£40) is allowed (> not >=)', () => {
  const r = validateClaim({
    claim: { claimPeriod: '2026-02-28', totalGross: 40 },
    items: [
      { expenseDate: '2026-02-16', expenseType_code: 'FOOD', reasonForTrip: 'Lunch', grossAmount: 20, receiptAttached: true },
      { expenseDate: '2026-02-16', expenseType_code: 'FOOD', reasonForTrip: 'Dinner', grossAmount: 20, receiptAttached: true }
    ],
    mileage: [], policy: POLICY, types: TYPES, today: TODAY
  });
  assert.ok(!hasErr(r, 'daily limit'), 'exactly at the limit must be allowed');
});
test('rule 5 BOUNDARY: meal spend one penny over the limit (£40.01) errors', () => {
  const r = validateClaim({
    claim: { claimPeriod: '2026-02-28', totalGross: 40.01 },
    items: [
      { expenseDate: '2026-02-16', expenseType_code: 'FOOD', reasonForTrip: 'Lunch', grossAmount: 20, receiptAttached: true },
      { expenseDate: '2026-02-16', expenseType_code: 'FOOD', reasonForTrip: 'Dinner', grossAmount: 20.01, receiptAttached: true }
    ],
    mileage: [], policy: POLICY, types: TYPES, today: TODAY
  });
  assert.ok(hasErr(r, 'daily limit'), 'over the limit must error');
});

// ═══ PART E — INTEGRATION edge cases (need the running service) ════════════════
const EMP = { username: 'sabarinathan.chandrasekar@bluestonex.com', password: 'sab' };
const MGR = { username: 'manager@bluestonex.com', password: 'mgr' };

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

// Safety net for D5: negative gross is BLOCKED at submit by validation rule 1.
test('D5 safety-net: a negative gross item is rejected at submit (rule 1, 422)', async () => {
  const c = await POST('/expense/MyClaims', { country: 'UK', claimPeriod: '2026-02-28' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'TOLLS', reasonForTrip: 'X', vatType: 'STD', grossAmount: -50 }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  const s = await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  assert.equal(s.status, 422, `negative gross must block submit, got ${s.status}`);
});

// D4 (FIXED): an invalid tax type is now rejected, not silently zero-rated.
test('D4 (fixed): item with mistyped vatType "std" is rejected at submit', async () => {
  const c = await POST('/expense/MyClaims', { country: 'UK', claimPeriod: '2026-02-28' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', reasonForTrip: 'X', vatType: 'std', grossAmount: 120, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  const s = await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  assert.equal(s.status, 422, 'an invalid tax type should be rejected');
});

// D6 (FIXED): INR claim audit/notification money now renders ₹, not £.
test('D6 (fixed): an India claim audit entry renders money as ₹, not £', async () => {
  const c = await POST('/expense/MyClaims', { country: 'IN', claimPeriod: '2026-02-28' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', reasonForTrip: 'X', vatType: 'STD', grossAmount: 118, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  const claim = (await GET(`/expense/MyClaims${active(id)}`, { auth: EMP })).data;
  const logs = await GET(`/approval/AuditLogs?$filter=action eq 'Submitted'`, { auth: MGR });
  const entry = logs.data.value.find((l) => l.objectKey === claim.claimNumber);
  assert.ok(entry, 'submit audit entry exists');
  assert.ok(entry.details.includes('₹') && !entry.details.includes('£'), 'INR audit money should use ₹');
});
