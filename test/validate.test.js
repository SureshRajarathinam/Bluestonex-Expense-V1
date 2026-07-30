const test = require('node:test');
const assert = require('node:assert/strict');
const { validateClaim } = require('../srv/lib/validate');
const { readPolicy } = require('./lib/config');

const TODAY = '2026-06-20';
// Thresholds/limits/rate come from the seeded UK POLICY config, not hardcoded —
// if the config changes, these tests follow it.
const POLICY = readPolicy('UK');
const TYPES = {
  HOTEL: { requiresReceipt: true }, FOOD: { requiresReceipt: true },
  TRAIN: { requiresReceipt: true }, TOLLS: { requiresReceipt: false }, TAXI: { requiresReceipt: true }
};

// A clean, fully-valid claim used as the baseline; each test mutates one thing.
const base = () => ({
  claim: { claimPeriod: '2026-02-28', totalGross: 24 },
  items: [{ expenseDate: '2026-02-16', expenseType_code: 'TOLLS', reasonForTrip: 'Office', grossAmount: 24, receiptAttached: false }],
  mileage: [],
  policy: POLICY, types: TYPES, today: TODAY
});
const run = (o) => validateClaim(o);
const hasErr = (r, substr) => r.errors.some((e) => e.toLowerCase().includes(substr.toLowerCase()));

test('baseline valid claim has no errors', () => {
  const r = run(base());
  assert.equal(r.errors.length, 0, `unexpected: ${r.errors.join(' | ')}`);
});

test('rule 1: required fields cannot be blank', () => {
  const o = base(); o.items[0].reasonForTrip = '   '; o.claim.claimPeriod = null;
  const r = run(o);
  assert.ok(hasErr(r, 'reason for trip is required'));
  assert.ok(hasErr(r, 'claim period is required'));
});

test('rule 2: expense date cannot be in the future', () => {
  const o = base(); o.items[0].expenseDate = '2099-01-01';
  assert.ok(hasErr(run(o), 'future'));
});

test('rule 3: claim total must equal sum of line items', () => {
  const o = base(); o.claim.totalGross = 999;
  assert.ok(hasErr(run(o), 'does not match the sum'));
});

test('rule 4: receipt mandatory when the expense type requires one (no amount threshold)', () => {
  const o = base();
  // TAXI is configured requiresReceipt=true → a receipt is required regardless of amount.
  o.items[0] = { expenseDate: '2026-02-16', expenseType_code: 'TAXI', reasonForTrip: 'Office', grossAmount: 50, receiptAttached: false };
  o.claim.totalGross = 50;
  assert.ok(hasErr(run(o), 'receipt is required'), 'a requiresReceipt type must require a receipt');
  o.items[0].receiptAttached = true;
  assert.ok(!hasErr(run(o), 'receipt is required'), 'receipt attached should clear it');
});

test('rule 4: a non-receipt type never requires a receipt, at ANY amount', () => {
  const o = base();
  // TOLLS is requiresReceipt=false → even a large amount needs no receipt (thresholds removed).
  o.items[0] = { expenseDate: '2026-02-16', expenseType_code: 'TOLLS', reasonForTrip: 'Toll', grossAmount: 100000, receiptAttached: false };
  o.claim.totalGross = 100000;
  assert.ok(!hasErr(run(o), 'receipt is required'), 'TOLLS never needs a receipt regardless of amount');
});

test('rule 5: meal daily limit is a SOFT flag (warns + flags, does not block)', () => {
  const o = base();
  const meal = POLICY.mealDailyLimit;
  o.items = [
    { expenseDate: '2026-02-16', expenseType_code: 'FOOD', reasonForTrip: 'Lunch', grossAmount: meal, receiptAttached: true },
    { expenseDate: '2026-02-16', expenseType_code: 'FOOD', reasonForTrip: 'Dinner', grossAmount: 15, receiptAttached: true }
  ];
  o.claim.totalGross = meal + 15; // one day's FOOD total exceeds the configured meal limit
  const r = run(o);
  assert.ok(!hasErr(r, 'daily limit'), 'a daily-limit breach must NOT block submission');
  assert.ok(r.flags.some((f) => f.toLowerCase().includes('daily limit')), 'it is raised as a policy flag for the approver');
  assert.ok(r.warnings.some((w) => w.toLowerCase().includes('daily limit')), 'and surfaced to the submitter as a warning');
});

test('rule 5: mileage rate cannot exceed policy rate', () => {
  const o = base();
  const overRate = POLICY.mileageRate + 0.5; // above the configured cap
  const total = Math.round(10 * overRate * 100) / 100;
  o.mileage = [{ tripDate: '2026-02-16', destination: 'X', reasonForTrip: 'Y', milesCount: 10, ratePerMile: overRate, totalAmount: total }];
  o.claim.totalGross = 24 + total;
  assert.ok(hasErr(run(o), 'exceeds the policy rate'));
});

test('rule 6: mileage requires distance and rate', () => {
  const o = base();
  o.mileage = [{ tripDate: '2026-02-16', destination: 'X', reasonForTrip: 'Y', milesCount: 0, ratePerMile: 0, totalAmount: 0 }];
  const r = run(o);
  assert.ok(hasErr(r, 'distance'));
  assert.ok(hasErr(r, 'rate per mile is required'));
});

test('rule 7: duplicate-looking items produce a warning, not an error', () => {
  const o = base();
  o.items = [
    { expenseDate: '2026-02-16', expenseType_code: 'TAXI', reasonForTrip: 'A', grossAmount: 20, receiptAttached: true },
    { expenseDate: '2026-02-16', expenseType_code: 'TAXI', reasonForTrip: 'B', grossAmount: 20, receiptAttached: true }
  ];
  o.claim.totalGross = 40;
  const r = run(o);
  assert.ok(r.warnings.some((w) => w.toLowerCase().includes('duplicate')), 'should warn');
  assert.ok(!hasErr(r, 'duplicate'), 'duplicate must not be a hard error');
});

test('rule 8: at least one line required', () => {
  const o = base(); o.items = []; o.mileage = []; o.claim.totalGross = 0;
  assert.ok(hasErr(run(o), 'at least one'));
});
