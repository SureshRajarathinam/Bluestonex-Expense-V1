'use strict';

const cds = require('@sap/cds');
const notification = require('./notification');

const LOG = cds.log('approval-service');

module.exports = class ApprovalService extends cds.ApplicationService {

  async init() {
    const { ExpenseClaims } = cds.entities('com.bluestonex.expense');

    // ─── Action: approveClaim (Manager) ────────────────────────────────────
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

      await notification.notifyManagerApproved({ ...claim, status: 'ManagerApproved' }, req.user.id);
      LOG.info(`Claim ${claim.claimNumber} approved by manager ${req.user.id}`);
      return SELECT.one.from(ExpenseClaims, ID);
    });

    // ─── Action: rejectClaim (Manager) ─────────────────────────────────────
    this.on('rejectClaim', 'TeamClaims', async (req) => {
      const { ID } = req.params[0];
      const { comment } = req.data;

      if (!comment?.trim()) return req.error(422, 'A rejection reason is required.');

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

    await super.init();
  }
};
