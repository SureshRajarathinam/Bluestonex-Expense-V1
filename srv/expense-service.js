'use strict';

const cds = require('@sap/cds');
const notification = require('./notification');

const LOG = cds.log('expense-service');

module.exports = class ExpenseService extends cds.ApplicationService {

  async init() {
    const {
      ExpenseClaims,
      ExpenseItems,
      MileageClaims,
      Employees
    } = cds.entities('com.bluestonex.expense');

    // ─── Before CREATE: auto-generate claim number ─────────────────────────
    this.before('CREATE', 'MyClaims', async (req) => {
      const year = new Date().getFullYear();
      const { count } = await SELECT.one`count(*) as count`.from(ExpenseClaims);
      const seq = String((count || 0) + 1).padStart(4, '0');
      req.data.claimNumber = `EXP-${year}-${seq}`;
      req.data.status = 'Draft';
      req.data.currency = req.data.currency || 'GBP';
    });

    // ─── Before CREATE/UPDATE expense items: calculate VAT split ──────────
    this.before(['CREATE', 'UPDATE'], 'MyClaimItems', (req) => {
      const { grossAmount, vatType } = req.data;
      if (grossAmount != null) {
        const vatRate = vatType === 'STD' ? 0.20 : 0.00;
        req.data.netAmount = parseFloat((grossAmount / (1 + vatRate)).toFixed(2));
        req.data.vatAmount = parseFloat((grossAmount - req.data.netAmount).toFixed(2));
      }
    });

    // ─── Before CREATE/UPDATE mileage: compute total ───────────────────────
    this.before(['CREATE', 'UPDATE'], 'MyMileageClaims', (req) => {
      const { milesCount, ratePerMile } = req.data;
      if (milesCount != null && ratePerMile != null) {
        req.data.totalAmount = parseFloat((milesCount * ratePerMile).toFixed(2));
      }
    });

    // ─── After item changes: recalculate claim totals ─────────────────────
    const recalcClaimTotals = async (claimId) => {
      if (!claimId) return;

      const items   = await SELECT.from(ExpenseItems).where({ claim_ID: claimId });
      const mileage = await SELECT.from(MileageClaims).where({ claim_ID: claimId });

      const totalNet   = items.reduce((s, i) => s + (i.netAmount || 0), 0);
      const totalVAT   = items.reduce((s, i) => s + (i.vatAmount || 0), 0);
      const totalItems = items.reduce((s, i) => s + (i.grossAmount || 0), 0);
      const totalMiles = mileage.reduce((s, m) => s + (m.totalAmount || 0), 0);

      await UPDATE(ExpenseClaims, claimId).with({
        totalNet:   parseFloat((totalNet + totalMiles).toFixed(2)),
        totalVAT:   parseFloat(totalVAT.toFixed(2)),
        totalGross: parseFloat((totalItems + totalMiles).toFixed(2))
      });
    };

    this.after(['CREATE', 'UPDATE', 'DELETE'], 'MyClaimItems', async (_, req) => {
      await recalcClaimTotals(req.data?.claim_ID);
    });

    this.after(['CREATE', 'UPDATE', 'DELETE'], 'MyMileageClaims', async (_, req) => {
      await recalcClaimTotals(req.data?.claim_ID);
    });

    // ─── Action: submitClaim ───────────────────────────────────────────────
    this.on('submitClaim', 'MyClaims', async (req) => {
      const { ID } = req.params[0];
      const claim = await SELECT.one.from(ExpenseClaims, ID);

      if (!claim)
        return req.error(404, 'Expense claim not found.');

      if (claim.status !== 'Draft')
        return req.error(409, `Claim ${claim.claimNumber} cannot be submitted — current status is '${claim.status}'.`);

      if ((claim.totalGross || 0) <= 0)
        return req.error(422, 'Please add at least one expense item or mileage entry before submitting.');

      await UPDATE(ExpenseClaims, ID).with({
        status: 'Submitted',
        submittedAt: new Date().toISOString()
      });

      const employee = await SELECT.one.from(Employees).where({ email: req.user.id });
      await notification.notifyClaimSubmitted(
        { ...claim, status: 'Submitted' },
        employee || { fullName: req.user.id }
      );

      LOG.info(`Claim ${claim.claimNumber} submitted by ${req.user.id}`);
      return SELECT.one.from(ExpenseClaims, ID);
    });

    // ─── Action: approveClaim (Manager) ───────────────────────────────────
    this.on('approveClaim', 'TeamClaims', async (req) => {
      const { ID } = req.params[0];
      const { comment } = req.data;
      const claim = await SELECT.one.from(ExpenseClaims, ID);

      if (!claim) return req.error(404, 'Expense claim not found.');
      if (claim.status !== 'Submitted')
        return req.error(409, `Claim ${claim.claimNumber} is not in Submitted status.`);

      await UPDATE(ExpenseClaims, ID).with({
        status: 'ManagerApproved',
        managerComment: comment || '',
        managerApprovedAt: new Date().toISOString(),
        managerApprovedBy: req.user.id
      });

      await notification.notifyManagerApproved(
        { ...claim, status: 'ManagerApproved' },
        req.user.id
      );

      LOG.info(`Claim ${claim.claimNumber} approved by manager ${req.user.id}`);
      return SELECT.one.from(ExpenseClaims, ID);
    });

    // ─── Action: rejectClaim (Manager) ────────────────────────────────────
    this.on('rejectClaim', 'TeamClaims', async (req) => {
      const { ID } = req.params[0];
      const { comment } = req.data;

      if (!comment?.trim())
        return req.error(422, 'A rejection reason is required.');

      const claim = await SELECT.one.from(ExpenseClaims, ID);
      if (!claim) return req.error(404, 'Expense claim not found.');
      if (claim.status !== 'Submitted')
        return req.error(409, `Claim ${claim.claimNumber} is not in Submitted status.`);

      await UPDATE(ExpenseClaims, ID).with({
        status: 'Rejected',
        managerComment: comment,
        managerApprovedBy: req.user.id
      });

      await notification.notifyRejected(claim, req.user.id, comment);

      LOG.info(`Claim ${claim.claimNumber} rejected by manager ${req.user.id}`);
      return SELECT.one.from(ExpenseClaims, ID);
    });

    // ─── Action: financeApprove ────────────────────────────────────────────
    this.on('financeApprove', 'FinanceClaims', async (req) => {
      const { ID } = req.params[0];
      const { comment } = req.data;
      const claim = await SELECT.one.from(ExpenseClaims, ID);

      if (!claim) return req.error(404, 'Expense claim not found.');
      if (claim.status !== 'ManagerApproved')
        return req.error(409, `Claim ${claim.claimNumber} has not been approved by a line manager yet.`);

      await UPDATE(ExpenseClaims, ID).with({
        status: 'FinanceApproved',
        financeComment: comment || '',
        financeApprovedAt: new Date().toISOString(),
        financeApprovedBy: req.user.id
      });

      await notification.notifyFinanceApproved(
        { ...claim, status: 'FinanceApproved' },
        req.user.id
      );

      LOG.info(`Claim ${claim.claimNumber} finance-approved by ${req.user.id}`);
      return SELECT.one.from(ExpenseClaims, ID);
    });

    // ─── Action: settleClaim ──────────────────────────────────────────────
    this.on('settleClaim', 'FinanceClaims', async (req) => {
      const { ID } = req.params[0];
      const claim = await SELECT.one.from(ExpenseClaims, ID);

      if (!claim) return req.error(404, 'Expense claim not found.');
      if (claim.status !== 'FinanceApproved')
        return req.error(409, `Claim ${claim.claimNumber} must be Finance Approved before settling.`);

      await UPDATE(ExpenseClaims, ID).with({
        status: 'Settled',
        settledAt: new Date().toISOString()
      });

      await notification.notifySettled({ ...claim, status: 'Settled' });

      LOG.info(`Claim ${claim.claimNumber} settled by ${req.user.id}`);
      return SELECT.one.from(ExpenseClaims, ID);
    });

    // ─── Action: rejectClaim (Finance) ────────────────────────────────────
    this.on('rejectClaim', 'FinanceClaims', async (req) => {
      const { ID } = req.params[0];
      const { comment } = req.data;

      if (!comment?.trim())
        return req.error(422, 'A rejection reason is required.');

      const claim = await SELECT.one.from(ExpenseClaims, ID);
      if (!claim) return req.error(404, 'Expense claim not found.');

      const validStatuses = ['Submitted', 'ManagerApproved'];
      if (!validStatuses.includes(claim.status))
        return req.error(409, `Claim ${claim.claimNumber} cannot be rejected from status '${claim.status}'.`);

      await UPDATE(ExpenseClaims, ID).with({
        status: 'Rejected',
        financeComment: comment,
        financeApprovedBy: req.user.id
      });

      await notification.notifyRejected(claim, req.user.id, comment);

      LOG.info(`Claim ${claim.claimNumber} rejected by finance ${req.user.id}`);
      return SELECT.one.from(ExpenseClaims, ID);
    });

    await super.init();
  }
};
