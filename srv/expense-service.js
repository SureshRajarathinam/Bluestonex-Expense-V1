'use strict';

const cds = require('@sap/cds');
const notification = require('./notification');
const { splitVAT, mileageTotal, claimTotals, taxRateFor } = require('./lib/calc');
const { validateClaim } = require('./lib/validate');
const { loadValidationContext, today } = require('./lib/load-claim');
const audit = require('./lib/audit');
const employeeSource = require('./lib/employee-source');
const { guardPaging } = require('./lib/paging');

// Title-case an email local-part ("jane.doe" → "Jane Doe") as a last-resort name.
const nameFromEmail = (email) => String(email || '').split('@')[0]
  .replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

const LOG = cds.log('expense-service');

module.exports = class ExpenseService extends cds.ApplicationService {

  async init() {
    const { CLAIMS, EMPLOYEES, POLICY, WORKFLOW } = cds.entities('EXP');

    // Reject malformed $top/$skip (400) instead of silently ignoring them.
    this.before('READ', guardPaging);

    // ─── whoami: resolve the logged-in user's display name for the greeting ────
    // Uses the shared employee source (EXP_EMPLOYEES in dev/test, USERS_MASTER in
    // prod when EMPLOYEE_SOURCE=USERS_MASTER); falls back to the email local-part.
    this.on('whoami', async (req) => {
      const email = req.user?.id || '';
      let fullName = '';
      try {
        const id = await employeeSource.findByEmail(email);
        fullName = (id && id.fullName) || '';
      } catch (e) { LOG.warn('whoami lookup failed', e.message); }
      if (!fullName) fullName = nameFromEmail(email);
      const parts = fullName.trim().split(/\s+/).filter(Boolean);
      const firstName = parts.shift() || '';
      const lastName = parts.join(' ');
      return { email, fullName: fullName.trim(), firstName, lastName };
    });

    // ─── Defaults: derive the employee from the logged-in user ─────────────
    // Employees never type their own ID — it comes from $user (the login).
    const applyDefaults = async (req) => {
      req.data.status   = req.data.status || 'Draft';
      req.data.currency = req.data.currency || 'GBP';
      const emp = await SELECT.one.from(EMPLOYEES).where({ email: req.user?.id });
      if (!req.data.employee_ID && emp) {
        req.data.employee_ID = emp.ID;
        if (!req.data.payrollArea) req.data.payrollArea = emp.payrollArea;
      }
    };

    // 'NEW' fires when a Fiori draft is created; 'CREATE' for non-draft inserts.
    this.before('NEW', 'MyClaims', applyDefaults);
    this.before('CREATE', 'MyClaims', applyDefaults);

    // ─── Before SAVE: the draft-correct place to compute everything ────────
    // Fires when a draft is activated. req.data holds the full tree (items +
    // mileageClaims), so we compute each line's VAT split, each mileage total,
    // and the rolled-up header totals — all atomically.
    this.before('SAVE', 'MyClaims', async (req) => {
      const claim = req.data;

      // Fallback: ensure the employee is set even if NEW didn't run
      if (!claim.employee_ID && req.user?.id) {
        const emp = await SELECT.one.from(EMPLOYEES).where({ email: req.user.id });
        if (emp) {
          claim.employee_ID = emp.ID;
          if (!claim.payrollArea) claim.payrollArea = emp.payrollArea;
        }
      }

      if (!claim.claimNumber) {
        // Derive from the highest existing suffix for the year (not a row COUNT):
        // survives deletions and, with the @assert.unique on claimNumber, a
        // concurrent collision surfaces as an error instead of a silent dup (D2).
        const year = new Date().getFullYear();
        const rows = await SELECT.from(CLAIMS).columns('claimNumber').where({ claimNumber: { like: `EXP-${year}-%` } });
        let max = 0;
        for (const r of rows) {
          const n = parseInt(String(r.claimNumber || '').split('-')[2], 10);
          if (Number.isFinite(n) && n > max) max = n;
        }
        claim.claimNumber = `EXP-${year}-${String(max + 1).padStart(4, '0')}`;
      }

      // Country drives tax (VAT for UK, GST for India) and currency
      const country = claim.country || 'UK';
      claim.currency = country === 'IN' ? 'INR' : 'GBP';
      // Per-country policy: load the row for this claim's country (UK | IN).
      const policy = await SELECT.one.from(POLICY).where({ country });
      const stdRate = taxRateFor(country, policy || {});

      for (const item of claim.items || []) {
        const { netAmount, vatAmount } = splitVAT(item.grossAmount, item.vatType, stdRate);
        item.netAmount = netAmount;
        item.vatAmount = vatAmount;
      }
      for (const m of claim.mileageClaims || []) {
        m.totalAmount = mileageTotal(m.milesCount, m.ratePerMile);
      }

      Object.assign(claim, claimTotals(claim.items, claim.mileageClaims));
    });

    // ─── Action: submitClaim ───────────────────────────────────────────────
    this.on('submitClaim', 'MyClaims', async (req) => {
      const p = req.params[0];
      const ID = p && typeof p === 'object' ? p.ID : p;
      const claim = await SELECT.one.from(CLAIMS, ID);

      if (!claim) return req.error(404, 'Expense claim not found.');
      // Submittable from Draft (first time) OR Returned (approver sent it back
      // for rework). A resubmit reuses the SAME record + claimNumber → no dup.
      if (!['Draft', 'Returned'].includes(claim.status))
        return req.error(409, `Claim ${claim.claimNumber} cannot be submitted — current status is '${claim.status}'.`);
      const wasReturned = claim.status === 'Returned';
      if (!claim.country)
        return req.error(422, 'Please select a country (UK or India) before submitting.');

      // Rule 8 — block submission if any critical policy violation exists
      const ctx = await loadValidationContext(ID);
      const { errors, warnings } = validateClaim({ ...ctx, today: today() });
      if (errors.length)
        return req.error(422, `This claim cannot be submitted:\n• ${errors.join('\n• ')}`);
      // Rule 7 — non-blocking warnings (e.g. possible duplicates)
      warnings.forEach((w) => req.warn(w));

      await UPDATE(CLAIMS, ID).with({
        status: 'Submitted',
        submittedAt: new Date().toISOString()
      });

      const employee = await SELECT.one.from(EMPLOYEES).where({ email: req.user.id });
      const wf = await SELECT.one.from(WORKFLOW).where({ country: claim.country });
      await notification.notifyClaimSubmitted({ ...claim, status: 'Submitted' }, employee || { fullName: req.user.id }, wf?.firstApprover);
      const sym = claim.currency === 'INR' ? '₹' : '£';
      // Distinguish a fresh submission from a rework resubmission so the History
      // timeline (and resubmitCount) can tell the two apart.
      await audit.record({ userId: req.user.id, action: wasReturned ? 'Resubmitted' : 'Submitted', objectType: 'ExpenseClaim', objectKey: claim.claimNumber, details: `Total ${sym}${claim.totalGross}` });

      LOG.info(`Claim ${claim.claimNumber} ${wasReturned ? 'resubmitted' : 'submitted'} by ${req.user.id}`);
      return SELECT.one.from(CLAIMS, ID);
    });

    await super.init();
  }
};
