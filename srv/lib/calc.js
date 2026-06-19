'use strict';

// Pure calculation helpers — no DB, fully unit-testable.

const round2 = (n) => parseFloat((Number(n) || 0).toFixed(2));

// VAT rate by type. STD = 20%, everything else (ZR / EX) = 0%.
function vatRate(vatType) {
  return vatType === 'STD' ? 0.20 : 0.00;
}

// Split a VAT-inclusive gross amount into net + VAT.
function splitVAT(grossAmount, vatType) {
  const gross = Number(grossAmount) || 0;
  const net   = round2(gross / (1 + vatRate(vatType)));
  const vat    = round2(gross - net);
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

module.exports = { round2, vatRate, splitVAT, mileageTotal, claimTotals };
