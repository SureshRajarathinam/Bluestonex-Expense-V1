'use strict';

const cds = require('@sap/cds');
const notification = require('./notification');
const { splitVAT, mileageTotal, claimTotals } = require('./lib/calc');

const LOG = cds.log('expense-service');

module.exports = class ExpenseService extends cds.ApplicationService {

  async init() {
    const { ExpenseClaims, Employees } = cds.entities('com.bluestonex.expense');

    // ─── Before CREATE: defaults for a new (draft) claim ───────────────────
    this.before('CREATE', 'MyClaims', (req) => {
      req.data.status   = 'Draft';
      req.data.currency = req.data.currency || 'GBP';
    });

    // ─── Before SAVE: the draft-correct place to compute everything ────────
    // Fires when a draft is activated. req.data holds the full tree (items +
    // mileageClaims), so we compute each line's VAT split, each mileage total,
    // and the rolled-up header totals — all atomically.
    this.before('SAVE', 'MyClaims', async (req) => {
      const claim = req.data;

      if (!claim.claimNumber) {
        const year = new Date().getFullYear();
        const rows = await SELECT.from(ExpenseClaims).columns('claimNumber');
        claim.claimNumber = `EXP-${year}-${String(rows.length + 1).padStart(4, '0')}`;
      }

      for (const item of claim.items || []) {
        const { netAmount, vatAmount } = splitVAT(item.grossAmount, item.vatType);
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
      if ((claim.totalGross || 0) <= 0)
        return req.error(422, 'Please add at least one expense item or mileage entry before submitting.');

      await UPDATE(ExpenseClaims, ID).with({
        status: 'Submitted',
        submittedAt: new Date().toISOString()
      });

      const employee = await SELECT.one.from(Employees).where({ email: req.user.id });
      await notification.notifyClaimSubmitted({ ...claim, status: 'Submitted' }, employee || { fullName: req.user.id });

      LOG.info(`Claim ${claim.claimNumber} submitted by ${req.user.id}`);
      return SELECT.one.from(ExpenseClaims, ID);
    });

    await super.init();
  }
};
