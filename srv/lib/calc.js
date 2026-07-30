'use strict';

// Pure calculation helpers — no DB, fully unit-testable.

const round2 = (n) => parseFloat((Number(n) || 0).toFixed(2));

// Standard tax rate for a country, resolved from the TAX_TYPES config rows: the
// STD treatment's `rate` for that country (UK VAT / India GST). `taxTypes` is the
// array of seeded TaxTypes rows ({ country, code, rate }). Falls back to the
// country default only when config is missing (defensive — config is authoritative).
function taxRateFor(country, taxTypes = []) {
  const rows = Array.isArray(taxTypes) ? taxTypes : [];
  const std = rows.find((t) => t.country === country && t.code === 'STD');
  if (std && std.rate != null) return Number(std.rate) || 0;
  return country === 'IN' ? 0.18 : 0.20; // UK / default
}

// Currency for a country: India → INR, everything else (UK/default) → GBP.
// Single source of truth for the country→currency mapping used at claim create
// and on save.
const currencyForCountry = (country) => (country === 'IN' ? 'INR' : 'GBP');

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

module.exports = { round2, taxRateFor, currencyForCountry, splitVAT, mileageTotal, claimTotals };
