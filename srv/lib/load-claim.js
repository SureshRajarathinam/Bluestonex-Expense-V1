'use strict';

const cds = require('@sap/cds');

// Loads everything the validator needs for a claim: header, items, mileage,
// the active policy, and a code→type map. Used by submit and finance approval.
async function loadValidationContext(claimId) {
  const { CLAIMS, ITEMS, MILEAGE, POLICY, EXPENSE_TYPES, TAX_TYPES } =
    cds.entities('EXP');

  const claim = await SELECT.one.from(CLAIMS, claimId);
  const items = await SELECT.from(ITEMS).where({ claim_ID: claimId });
  const mileage = await SELECT.from(MILEAGE).where({ claim_ID: claimId });

  // A receipt counts as attached if an actual file was uploaded OR the flag is set.
  const withReceipt = items.length
    ? await SELECT.from(ITEMS).columns('ID').where({ claim_ID: claimId, receipt: { '!=': null } })
    : [];
  const hasReceipt = new Set(withReceipt.map((r) => r.ID));
  items.forEach((it) => { it.receiptAttached = it.receiptAttached || hasReceipt.has(it.ID); });
  // Per-country policy: load the row for this claim's country (UK | IN).
  const policy = (await SELECT.one.from(POLICY).where({ country: claim.country })) || {};
  const typeRows = await SELECT.from(EXPENSE_TYPES);
  const types = Object.fromEntries(typeRows.map((t) => [t.code, t]));
  // Valid tax-type codes (STD/ZR/EX) for THIS claim's country, so the validator
  // can reject a mistyped vatType instead of it being silently zero-rated (D4).
  const vatTypeRows = await SELECT.from(TAX_TYPES).where({ country: claim.country });
  const vatTypes = new Set(vatTypeRows.map((v) => v.code));

  return { claim, items, mileage, policy, types, vatTypes };
}

const today = () => new Date().toISOString().slice(0, 10);

module.exports = { loadValidationContext, today };
