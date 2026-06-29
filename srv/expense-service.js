'use strict';

const cds = require('@sap/cds');
const notification = require('./notification');
const { splitVAT, mileageTotal, claimTotals, taxRateFor } = require('./lib/calc');
const { validateClaim } = require('./lib/validate');
const { loadValidationContext, today } = require('./lib/load-claim');
const audit = require('./lib/audit');

const LOG = cds.log('expense-service');

module.exports = class ExpenseService extends cds.ApplicationService {

  async init() {
    const { ExpenseClaims, Employees, ExpensePolicy } = cds.entities('com.bluestonex.expense');

    // ─── Defaults: derive the employee from the logged-in user ─────────────
    // Employees never type their own ID — it comes from $user (the login).
    const applyDefaults = async (req) => {
      req.data.status   = req.data.status || 'Draft';
      req.data.currency = req.data.currency || 'GBP';
      const emp = await SELECT.one.from(Employees).where({ email: req.user?.id });
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
        const emp = await SELECT.one.from(Employees).where({ email: req.user.id });
        if (emp) {
          claim.employee_ID = emp.ID;
          if (!claim.payrollArea) claim.payrollArea = emp.payrollArea;
        }
      }

      if (!claim.claimNumber) {
        const year = new Date().getFullYear();
        const rows = await SELECT.from(ExpenseClaims).columns('claimNumber');
        claim.claimNumber = `EXP-${year}-${String(rows.length + 1).padStart(4, '0')}`;
      }

      // Country drives tax (VAT for UK, GST for India) and currency
      const country = claim.country || 'UK';
      claim.currency = country === 'IN' ? 'INR' : 'GBP';
      // Per-country policy: load the row for this claim's country (UK | IN).
      const policy = await SELECT.one.from(ExpensePolicy).where({ country });
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
      const claim = await SELECT.one.from(ExpenseClaims, ID);

      if (!claim) return req.error(404, 'Expense claim not found.');
      if (claim.status !== 'Draft')
        return req.error(409, `Claim ${claim.claimNumber} cannot be submitted — current status is '${claim.status}'.`);
      if (!claim.country)
        return req.error(422, 'Please select a country (UK or India) before submitting.');

      // Rule 8 — block submission if any critical policy violation exists
      const ctx = await loadValidationContext(ID);
      const { errors, warnings } = validateClaim({ ...ctx, today: today() });
      if (errors.length)
        return req.error(422, `This claim cannot be submitted:\n• ${errors.join('\n• ')}`);
      // Rule 7 — non-blocking warnings (e.g. possible duplicates)
      warnings.forEach((w) => req.warn(w));

      await UPDATE(ExpenseClaims, ID).with({
        status: 'Submitted',
        submittedAt: new Date().toISOString()
      });

      const employee = await SELECT.one.from(Employees).where({ email: req.user.id });
      await notification.notifyClaimSubmitted({ ...claim, status: 'Submitted' }, employee || { fullName: req.user.id });
      await audit.record({ userId: req.user.id, action: 'Submitted', objectType: 'ExpenseClaim', objectKey: claim.claimNumber, details: `Total £${claim.totalGross}` });

      LOG.info(`Claim ${claim.claimNumber} submitted by ${req.user.id}`);
      return SELECT.one.from(ExpenseClaims, ID);
    });

    await super.init();
  }
};
