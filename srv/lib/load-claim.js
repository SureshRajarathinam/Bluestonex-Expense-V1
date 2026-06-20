'use strict';

const cds = require('@sap/cds');

// Loads everything the validator needs for a claim: header, items, mileage,
// the active policy, and a code→type map. Used by submit and finance approval.
async function loadValidationContext(claimId) {
  const { ExpenseClaims, ExpenseItems, MileageClaims, ExpensePolicy, ExpenseTypes } =
    cds.entities('com.bluestonex.expense');

  const claim = await SELECT.one.from(ExpenseClaims, claimId);
  const items = await SELECT.from(ExpenseItems).where({ claim_ID: claimId });
  const mileage = await SELECT.from(MileageClaims).where({ claim_ID: claimId });

  // A receipt counts as attached if an actual file was uploaded OR the flag is set.
  const withReceipt = items.length
    ? await SELECT.from(ExpenseItems).columns('ID').where({ claim_ID: claimId, receipt: { '!=': null } })
    : [];
  const hasReceipt = new Set(withReceipt.map((r) => r.ID));
  items.forEach((it) => { it.receiptAttached = it.receiptAttached || hasReceipt.has(it.ID); });
  const policy = (await SELECT.one.from(ExpensePolicy)) || {};
  const typeRows = await SELECT.from(ExpenseTypes);
  const types = Object.fromEntries(typeRows.map((t) => [t.code, t]));

  return { claim, items, mileage, policy, types };
}

const today = () => new Date().toISOString().slice(0, 10);

module.exports = { loadValidationContext, today };
