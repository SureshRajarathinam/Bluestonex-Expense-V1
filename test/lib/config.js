'use strict';
// Config-driven test helper. Reads expected values from the SEEDED configuration
// tables (the db/data CSVs that populate POLICY / TAX_TYPES / WORKFLOW) so tests
// never hardcode a rate, limit, tax rate or approver email that the config owns.
// The CSV is the single source of truth the in-memory DB is loaded from, so
// deriving from it keeps tests and runtime in lock-step.
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'db', 'data');

function parseCsv(file) {
  const txt = fs.readFileSync(path.join(DATA, file), 'utf8').replace(/^﻿/, '').trim();
  const [head, ...lines] = txt.split(/\r?\n/);
  const cols = head.split(',').map((c) => c.trim());
  return lines.filter(Boolean).map((ln) => {
    const cells = ln.split(',');
    const o = {};
    cols.forEach((c, i) => { o[c] = (cells[i] == null ? '' : cells[i]).trim(); });
    return o;
  });
}

const cache = {};
const rows = (file) => (cache[file] || (cache[file] = parseCsv(file)));
const numOrUndef = (v) => (v === '' || v == null ? undefined : Number(v));

// Full POLICY row for a country, numerically coerced (matches srv/lib/calc + validate).
function readPolicy(country) {
  const r = rows('EXP-POLICY.csv').find((p) => p.country === country) || {};
  return {
    country: r.country,
    policyName: r.policyName,
    mileageRate: numOrUndef(r.mileageRate),
    hotelDailyLimit: numOrUndef(r.hotelDailyLimit),
    mealDailyLimit: numOrUndef(r.mealDailyLimit),
    receiptThreshold: numOrUndef(r.receiptThreshold),
    vatRate: numOrUndef(r.vatRate),
    gstRate: numOrUndef(r.gstRate),
    claimNumberStart: r.claimNumberStart
  };
}

// The standard tax rate a country actually charges (UK VAT / India GST), as the
// engine would resolve it via calc.taxRateFor.
function readStdRate(country) {
  const p = readPolicy(country);
  return country === 'IN' ? p.gstRate : p.vatRate;
}

// A specific TAX_TYPES rate (e.g. STD/ZR/EX) for a country.
function readTaxRate(country, code) {
  const r = rows('EXP-TAX_TYPES.csv').find((t) => t.country === country && t.code === code);
  return r ? Number(r.rate) : undefined;
}

// Configured approver emails for a country: { first, second } (second null for IN).
function readApprovers(country) {
  const r = rows('EXP-WORKFLOW.csv').find((w) => w.country === country) || {};
  return { first: r.firstApprover || null, second: r.secondApprover || null };
}

module.exports = { readPolicy, readStdRate, readTaxRate, readApprovers };
