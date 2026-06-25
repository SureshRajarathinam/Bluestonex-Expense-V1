'use strict';

// Pure calculation helpers — no DB, fully unit-testable.

const round2 = (n) => parseFloat((Number(n) || 0).toFixed(2));

// Standard tax rate for a country, read from policy:
//   UK → VAT rate, India (IN) → GST rate. Defaults to UK VAT if unknown.
function taxRateFor(country, policy = {}) {
  if (country === 'IN') return Number(policy.gstRate ?? 0.18);
  return Number(policy.vatRate ?? 0.20); // UK / default
}

// Split a tax-inclusive gross amount into net + tax.
//   taxType 'STD' applies the given standard rate; 'ZR'/'EX' apply 0%.
//   `stdRate` is the country-derived standard rate (VAT for UK, GST for India).
function splitVAT(grossAmount, taxType, stdRate = 0.20) {
  const gross = Number(grossAmount) || 0;
  const rate  = taxType === 'STD' ? Number(stdRate) || 0 : 0;
  const net   = round2(gross / (1 + rate));
  const vat   = round2(gross - net);
  return { netAmount: net, vatAmount: vat };
}

// Mileage total = miles × rate.
function mileageTotal(milesCount, ratePerMile) {
  return round2((Number(milesCount) || 0) * (Number(ratePerMile) || 0));
}

// Roll up header totals from items + mileage rows.
// Net total includes mileage (mileage has no VAT); gross total includes mileage.
function claimTotals(items = [], mileage = []) {
  const itemsNet   = items.reduce((s, i) => s + (Number(i.netAmount)   || 0), 0);
  const itemsVat   = items.reduce((s, i) => s + (Number(i.vatAmount)   || 0), 0);
  const itemsGross = items.reduce((s, i) => s + (Number(i.grossAmount) || 0), 0);
  const miles      = mileage.reduce((s, m) => s + (Number(m.totalAmount) || 0), 0);
  return {
    totalNet:   round2(itemsNet + miles),
    totalVAT:   round2(itemsVat),
    totalGross: round2(itemsGross + miles)
  };
}

module.exports = { round2, taxRateFor, splitVAT, mileageTotal, claimTotals };
