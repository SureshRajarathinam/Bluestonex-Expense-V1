const test = require('node:test');
const assert = require('node:assert/strict');
const { validateClaim } = require('../srv/lib/validate');

const TODAY = '2026-06-20';
const POLICY = { receiptThreshold: 25, mealDailyLimit: 40, hotelDailyLimit: 200, mileageRate: 0.25 };
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

test('rule 4: receipt mandatory at/above threshold', () => {
  const o = base();
  o.items[0] = { expenseDate: '2026-02-16', expenseType_code: 'TAXI', reasonForTrip: 'Office', grossAmount: 30, receiptAttached: false };
  o.claim.totalGross = 30;
  assert.ok(hasErr(run(o), 'receipt is required'), 'should require receipt for £30 > £25');
  o.items[0].receiptAttached = true;
  assert.ok(!hasErr(run(o), 'receipt is required'), 'receipt attached should clear it');
});

test('rule 5: meal daily limit enforced', () => {
  const o = base();
  o.items = [
    { expenseDate: '2026-02-16', expenseType_code: 'FOOD', reasonForTrip: 'Lunch', grossAmount: 30, receiptAttached: true },
    { expenseDate: '2026-02-16', expenseType_code: 'FOOD', reasonForTrip: 'Dinner', grossAmount: 25, receiptAttached: true }
  ];
  o.claim.totalGross = 55; // 55 > 40 meal limit for that day
  assert.ok(hasErr(run(o), 'exceed the daily limit'));
});

test('rule 5: mileage rate cannot exceed policy rate', () => {
  const o = base();
  o.mileage = [{ tripDate: '2026-02-16', destination: 'X', reasonForTrip: 'Y', milesCount: 10, ratePerMile: 0.99, totalAmount: 9.9 }];
  o.claim.totalGross = 24 + 9.9;
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
