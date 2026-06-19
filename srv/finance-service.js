'use strict';

const cds = require('@sap/cds');
const notification = require('./notification');

const LOG = cds.log('finance-service');

// Bound-action key: object {ID,...} for draft entities, raw scalar otherwise.
const idOf = (req) => { const p = req.params[0]; return p && typeof p === 'object' ? p.ID : p; };

module.exports = class FinanceService extends cds.ApplicationService {

  async init() {
    const { ExpenseClaims } = cds.entities('com.bluestonex.expense');

    // ─── Action: financeApprove ────────────────────────────────────────────
    this.on('financeApprove', 'FinanceClaims', async (req) => {
      const ID = idOf(req);
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

      await notification.notifyFinanceApproved({ ...claim, status: 'FinanceApproved' }, req.user.id);
      LOG.info(`Claim ${claim.claimNumber} finance-approved by ${req.user.id}`);
      return SELECT.one.from(ExpenseClaims, ID);
    });

    // ─── Action: settleClaim ───────────────────────────────────────────────
    this.on('settleClaim', 'FinanceClaims', async (req) => {
      const ID = idOf(req);
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

    // ─── Action: rejectClaim (Finance) ─────────────────────────────────────
    this.on('rejectClaim', 'FinanceClaims', async (req) => {
      const ID = idOf(req);
      const { comment } = req.data;

      if (!comment?.trim()) return req.error(422, 'A rejection reason is required.');

      const claim = await SELECT.one.from(ExpenseClaims, ID);
      if (!claim) return req.error(404, 'Expense claim not found.');

      if (!['Submitted', 'ManagerApproved'].includes(claim.status))
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
