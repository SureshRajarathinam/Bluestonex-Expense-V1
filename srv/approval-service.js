'use strict';

const cds = require('@sap/cds');
const notification = require('./notification');
const audit = require('./lib/audit');

const LOG = cds.log('approval-service');

// Bound-action key: object {ID,...} for draft entities, raw scalar otherwise.
const idOf = (req) => { const p = req.params[0]; return p && typeof p === 'object' ? p.ID : p; };

module.exports = class ApprovalService extends cds.ApplicationService {

  async init() {
    const { ExpenseClaims } = cds.entities('com.bluestonex.expense');

    // ─── Action: approveClaim (Manager) ────────────────────────────────────
    this.on('approveClaim', 'TeamClaims', async (req) => {
      const ID = idOf(req);
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
      await audit.record({ userId: req.user.id, action: 'ManagerApproved', objectType: 'ExpenseClaim', objectKey: claim.claimNumber, details: comment || '' });
      LOG.info(`Claim ${claim.claimNumber} approved by manager ${req.user.id}`);
      return SELECT.one.from(ExpenseClaims, ID);
    });

    // ─── Action: rejectClaim (Manager) ─────────────────────────────────────
    this.on('rejectClaim', 'TeamClaims', async (req) => {
      const ID = idOf(req);
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
      await audit.record({ userId: req.user.id, action: 'Rejected', objectType: 'ExpenseClaim', objectKey: claim.claimNumber, details: `Manager: ${comment}` });
      LOG.info(`Claim ${claim.claimNumber} rejected by manager ${req.user.id}`);
      return SELECT.one.from(ExpenseClaims, ID);
    });

    await super.init();
  }
};
