'use strict';
// Unit top-up — calc.js helpers that were only exercised indirectly. Pure, no
// server. Avoids asserting known-ambiguous IEEE-754 half-way cases; asserts only
// well-defined coercion/rounding behaviour.
const test = require('node:test');
const assert = require('node:assert/strict');
const { round2, mileageTotal, claimTotals } = require('../srv/lib/calc');

test('round2 coerces non-numeric input to 0 and rounds to 2dp', () => {
  assert.equal(round2(null), 0);
  assert.equal(round2(undefined), 0);
  assert.equal(round2('abc'), 0);
  assert.equal(round2('20.00'), 20, 'HANA string-decimal coerced');
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(1234.567), 1234.57);
  assert.equal(round2(-5.556), -5.56);
});

test('mileageTotal coerces null/non-numeric args to 0 and rounds', () => {
  assert.equal(mileageTotal(null, 0.25), 0);
  assert.equal(mileageTotal(10, null), 0);
  assert.equal(mileageTotal('abc', 0.25), 0);
  assert.equal(mileageTotal(100, 0.25), 25);
  assert.equal(mileageTotal(3, 0.45), 1.35);
});

test('claimTotals folds mileage into net + gross but never into VAT', () => {
  const items = [{ netAmount: 83.33, vatAmount: 16.67, grossAmount: 100 }];
  const mileage = [{ totalAmount: 25 }];
  const t = claimTotals(items, mileage);
  assert.equal(t.totalNet, 108.33, 'itemsNet + mileage');
  assert.equal(t.totalVAT, 16.67, 'mileage adds no VAT');
  assert.equal(t.totalGross, 125, 'itemsGross + mileage');
});

test('claimTotals defaults empty rows to zero and ignores mileage vatAmount', () => {
  assert.deepEqual(claimTotals(), { totalNet: 0, totalVAT: 0, totalGross: 0 });
  const t = claimTotals([], [{ totalAmount: 10, vatAmount: 99 }]);
  assert.equal(t.totalVAT, 0, 'a mileage row vatAmount must not leak into totalVAT');
  assert.equal(t.totalNet, 10);
  assert.equal(t.totalGross, 10);
});
