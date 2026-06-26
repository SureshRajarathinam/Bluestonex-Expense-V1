'use strict';

const { round2 } = require('./calc');

// Normalise a date value to 'YYYY-MM-DD' for comparison.
const ymd = (d) => (typeof d === 'string' ? d.slice(0, 10) : d ? new Date(d).toISOString().slice(0, 10) : null);

const blank = (s) => s == null || String(s).trim() === '';

// Validate a full claim against company policy.
// Returns { errors, warnings } — errors block submission/approval, warnings don't.
//   claim   : header { claimPeriod, totalGross, ... }
//   items   : [{ expenseDate, expenseType_code, reasonForTrip, grossAmount, receiptAttached }]
//   mileage : [{ tripDate, destination, reasonForTrip, milesCount, ratePerMile, totalAmount }]
//   policy  : { receiptThreshold, mealDailyLimit, hotelDailyLimit, mileageRate }
//   types   : { CODE: { requiresReceipt } }
//   today   : 'YYYY-MM-DD'
function validateClaim({ claim = {}, items = [], mileage = [], policy = {}, types = {}, today }) {
  const errors = [];
  const warnings = [];

  const threshold = Number(policy.receiptThreshold ?? 25);
  const mealLimit = Number(policy.mealDailyLimit ?? 0);
  const hotelLimit = Number(policy.hotelDailyLimit ?? 0);
  const maxRate = Number(policy.mileageRate ?? 0);

  // Rule 1 — required header field
  if (blank(claim.claimPeriod)) errors.push('Claim period is required.');

  // Rule 2 (header) — period end, when given, must not precede the start
  if (!blank(claim.periodEnd) && !blank(claim.claimPeriod) && ymd(claim.periodEnd) < ymd(claim.claimPeriod))
    errors.push('Claim period end date cannot be before the start date.');

  // Rule 8 — must have at least one line
  if (items.length === 0 && mileage.length === 0) {
    errors.push('Add at least one expense item or mileage entry before submitting.');
  }

  // ── Expense items ──────────────────────────────────────────────────────────
  const dupKeys = new Map();
  const perDay = {};
  items.forEach((it, i) => {
    const n = `Expense item ${i + 1}`;
    const gross = Number(it.grossAmount);

    // Rule 1 — required fields
    if (blank(it.expenseType_code)) errors.push(`${n}: expense type is required.`);
    if (blank(it.reasonForTrip)) errors.push(`${n}: reason for trip is required.`);
    if (blank(it.expenseDate)) errors.push(`${n}: date is required.`);
    if (it.grossAmount == null || gross <= 0) errors.push(`${n}: gross amount must be greater than 0.`);

    // Rule 2 — date not in the future
    if (it.expenseDate && today && ymd(it.expenseDate) > today)
      errors.push(`${n}: date ${ymd(it.expenseDate)} cannot be in the future.`);

    // Rule 4 — receipt mandatory at/above threshold (or when the type requires it)
    const type = types[it.expenseType_code] || {};
    const needsReceipt = type.requiresReceipt || (gross > 0 && gross >= threshold);
    if (needsReceipt && !it.receiptAttached)
      errors.push(`${n}: a receipt is required (£${round2(gross || 0)} ≥ £${threshold} threshold or policy requires one).`);

    // Rule 7 — duplicate detection (warning)
    if (it.expenseDate && it.expenseType_code && gross > 0) {
      const key = `${ymd(it.expenseDate)}|${it.expenseType_code}|${round2(gross)}`;
      dupKeys.set(key, (dupKeys.get(key) || 0) + 1);
    }

    // accumulate per-day totals by type for Rule 5
    const d = ymd(it.expenseDate);
    if (d && gross > 0) {
      perDay[d] = perDay[d] || {};
      perDay[d][it.expenseType_code] = (perDay[d][it.expenseType_code] || 0) + gross;
    }
  });

  // Rule 7 — emit duplicate warnings
  for (const [key, count] of dupKeys) {
    if (count > 1) {
      const [d, type, amt] = key.split('|');
      warnings.push(`Possible duplicate: ${count} ${type} items on ${d} for £${amt} each — please verify.`);
    }
  }

  // Rule 5 — daily meal / hotel limits
  for (const [d, sums] of Object.entries(perDay)) {
    if (mealLimit > 0 && (sums.FOOD || 0) > mealLimit)
      errors.push(`Meals on ${d} (£${round2(sums.FOOD)}) exceed the daily limit of £${mealLimit}.`);
    if (hotelLimit > 0 && (sums.HOTEL || 0) > hotelLimit)
      errors.push(`Hotel on ${d} (£${round2(sums.HOTEL)}) exceeds the daily limit of £${hotelLimit}.`);
  }

  // ── Mileage entries ─────────────────────────────────────────────────────────
  mileage.forEach((m, i) => {
    const n = `Mileage entry ${i + 1}`;
    const miles = Number(m.milesCount);
    const rate = Number(m.ratePerMile);

    // Rule 1 — required fields
    if (blank(m.tripDate)) errors.push(`${n}: trip date is required.`);
    if (blank(m.destination)) errors.push(`${n}: destination is required.`);
    if (blank(m.reasonForTrip)) errors.push(`${n}: reason for trip is required.`);

    // Rule 2 — date not in the future
    if (m.tripDate && today && ymd(m.tripDate) > today)
      errors.push(`${n}: trip date cannot be in the future.`);

    // Rule 6 — mileage needs distance and rate
    if (m.milesCount == null || miles <= 0) errors.push(`${n}: distance (miles) must be greater than 0.`);
    if (m.ratePerMile == null || rate <= 0) errors.push(`${n}: rate per mile is required.`);

    // Rule 5 — rate must not exceed the policy rate
    if (maxRate > 0 && rate > maxRate)
      errors.push(`${n}: rate £${rate}/mile exceeds the policy rate of £${maxRate}/mile.`);
  });

  // Rule 3 / 10 — claim total must equal the sum of all lines
  const itemsGross = items.reduce((s, it) => s + (Number(it.grossAmount) || 0), 0);
  const milesGross = mileage.reduce((s, m) => s + (Number(m.totalAmount) || 0), 0);
  const expected = round2(itemsGross + milesGross);
  if (round2(claim.totalGross || 0) !== expected)
    errors.push(`Claim total (£${round2(claim.totalGross || 0)}) does not match the sum of line items (£${expected}).`);

  return { errors, warnings };
}

module.exports = { validateClaim };
