'use strict';
// Unit — load-claim.js loadValidationContext()/today(). Seeds a claim directly in
// the in-memory DB, then asserts the loader's receipt OR-merge, empty-items skip,
// per-country policy/tax-type resolution, and the today() shape.
const cds = require('@sap/cds');
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadValidationContext, today } = require('../srv/lib/load-claim');

cds.test(process.cwd());

async function insertClaim(country) {
  const { CLAIMS } = cds.entities('EXP');
  const ID = cds.utils.uuid();
  await INSERT.into(CLAIMS).entries({ ID, country, status: 'Draft', claimPeriod: '2026-02-01' });
  return ID;
}

test('loadValidationContext OR-merges receiptAttached (flag OR uploaded blob) + loads UK policy/tax types', async () => {
  const { ITEMS } = cds.entities('EXP');
  const id = await insertClaim('UK');
  const a = cds.utils.uuid(), b = cds.utils.uuid(), c = cds.utils.uuid();
  await INSERT.into(ITEMS).entries([
    { ID: a, claim_ID: id, expenseType_code: 'FOOD', grossAmount: 30, receiptAttached: true },
    { ID: b, claim_ID: id, expenseType_code: 'TAXI', grossAmount: 12, receiptAttached: false, receipt: Buffer.from('img') },
    { ID: c, claim_ID: id, expenseType_code: 'TOLLS', grossAmount: 5, receiptAttached: false }
  ]);
  const ctx = await loadValidationContext(id);
  const byId = Object.fromEntries(ctx.items.map((i) => [i.ID, i]));
  assert.equal(byId[a].receiptAttached, true, 'flag set → attached');
  assert.equal(byId[b].receiptAttached, true, 'uploaded blob → attached (OR-merge)');
  assert.equal(byId[c].receiptAttached, false, 'neither → not attached');
  assert.equal(Number(ctx.policy.receiptThreshold), 25, 'UK policy row loaded from config');
  assert.ok(ctx.vatTypes.has('STD') && ctx.vatTypes.has('ZR') && ctx.vatTypes.has('EX'), 'UK tax-type codes');
  assert.ok(ctx.types.FOOD, 'expense-type map populated');
});

test('loadValidationContext with no items skips the receipt query and returns empty sets', async () => {
  const id = await insertClaim('UK');
  const ctx = await loadValidationContext(id);
  assert.equal(ctx.items.length, 0);
  assert.equal(ctx.mileage.length, 0);
});

test('loadValidationContext for an unknown country → empty policy {} and empty vatTypes', async () => {
  const id = await insertClaim('ZZ');
  const ctx = await loadValidationContext(id);
  assert.deepEqual(ctx.policy, {}, 'no policy row → {}');
  assert.equal(ctx.vatTypes.size, 0, 'no tax types for an unknown country');
});

test('today() returns an ISO yyyy-mm-dd string', () => {
  const d = today();
  assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(d.length, 10);
});
