'use strict';

const cds = require('@sap/cds');
const notification = require('./notification');
const audit = require('./lib/audit');

const LOG = cds.log('approval-service');

// Bound-action key: object {ID,...} for draft entities, raw scalar otherwise.
const idOf = (req) => { const p = req.params[0]; return p && typeof p === 'object' ? p.ID : p; };

module.exports = class ApprovalService extends cds.ApplicationService {

  async init() {
    const { ExpenseClaims, ApprovalWorkflow } = cds.entities('com.bluestonex.expense');

    // ─── Action: approve (country-aware: UK 2-level, India 1-level) ──────────
    this.on('approve', 'Approvals', async (req) => {
      const ID = idOf(req);
      const { comment } = req.data;
      const claim = await SELECT.one.from(ExpenseClaims, ID);
      if (!claim) return req.error(404, 'Expense claim not found.');

      const wf = await SELECT.one.from(ApprovalWorkflow).where({ country: claim.country });
      if (!wf) return req.error(422, `No approval workflow is configured for ${claim.country}.`);

      const me = req.user.id;
      const now = new Date().toISOString();

      if (claim.status === 'Submitted') {
        if (me !== wf.firstApprover)
          return req.error(403, `You are not the first-level approver for ${claim.country}.`);

        if (claim.country === 'UK') {
          await UPDATE(ExpenseClaims, ID).with({
            status: 'FirstApproved', level1ApprovedBy: me, level1ApprovedAt: now, level1Comment: comment || ''
          });
          await audit.record({ userId: me, action: 'FirstApproved', objectType: 'ExpenseClaim', objectKey: claim.claimNumber, details: `Level 1 approved; awaiting level 2 (${wf.secondApprover || 'n/a'})` });
        } else {
          await UPDATE(ExpenseClaims, ID).with({
            status: 'Approved', level1ApprovedBy: me, level1ApprovedAt: now, level1Comment: comment || ''
          });
          await audit.record({ userId: me, action: 'Approved', objectType: 'ExpenseClaim', objectKey: claim.claimNumber, details: `Single-level (India) approval complete` });
        }
      } else if (claim.status === 'FirstApproved') {
        if (me !== wf.secondApprover)
          return req.error(403, `You are not the second-level approver for ${claim.country}.`);
        await UPDATE(ExpenseClaims, ID).with({
          status: 'Approved', level2ApprovedBy: me, level2ApprovedAt: now, level2Comment: comment || ''
        });
        await audit.record({ userId: me, action: 'Approved', objectType: 'ExpenseClaim', objectKey: claim.claimNumber, details: `Level 2 approval complete` });
      } else {
        return req.error(409, `Claim ${claim.claimNumber} is not awaiting approval (status '${claim.status}').`);
      }

      LOG.info(`Claim ${claim.claimNumber} approved by ${me}`);
      return SELECT.one.from(ExpenseClaims, ID);
    });

    // ─── Action: reject ─────────────────────────────────────────────────────
    this.on('reject', 'Approvals', async (req) => {
      const ID = idOf(req);
      const { comment } = req.data;
      if (!comment?.trim()) return req.error(422, 'A rejection reason is required.');

      const claim = await SELECT.one.from(ExpenseClaims, ID);
      if (!claim) return req.error(404, 'Expense claim not found.');
      if (!['Submitted', 'FirstApproved'].includes(claim.status))
        return req.error(409, `Claim ${claim.claimNumber} cannot be rejected (status '${claim.status}').`);

      const wf = await SELECT.one.from(ApprovalWorkflow).where({ country: claim.country });
      const me = req.user.id;
      const allowed =
        (claim.status === 'Submitted' && me === wf?.firstApprover) ||
        (claim.status === 'FirstApproved' && me === wf?.secondApprover);
      if (!allowed) return req.error(403, 'You are not the assigned approver for this claim.');

      await UPDATE(ExpenseClaims, ID).with({ status: 'Rejected', rejectedBy: me, rejectionReason: comment });
      await notification.notifyRejected(claim, me, comment);
      await audit.record({ userId: me, action: 'Rejected', objectType: 'ExpenseClaim', objectKey: claim.claimNumber, details: comment });

      LOG.info(`Claim ${claim.claimNumber} rejected by ${me}`);
      return SELECT.one.from(ExpenseClaims, ID);
    });

    // ─── Policy Configuration: validate + audit (draft SAVE) ────────────────
    this.before('SAVE', 'Policies', (req) => {
      const p = req.data;
      if (p.mileageRate != null && Number(p.mileageRate) <= 0)
        return req.error(422, 'Mileage rate must be greater than 0.');
      for (const [f, label] of [['hotelDailyLimit', 'Hotel daily limit'], ['mealDailyLimit', 'Meal daily limit'], ['receiptThreshold', 'Receipt threshold']]) {
        if (p[f] != null && Number(p[f]) < 0) return req.error(422, `${label} cannot be negative.`);
      }
      for (const [f, label] of [['vatRate', 'VAT rate'], ['gstRate', 'GST rate']]) {
        if (p[f] != null && (Number(p[f]) < 0 || Number(p[f]) > 1))
          return req.error(422, `${label} must be between 0 and 1 (e.g. 0.20 for 20%).`);
      }
    });

    this.after('SAVE', 'Policies', async (data, req) => {
      await audit.record({
        userId: req.user.id, action: 'PolicyChanged', objectType: 'ExpensePolicy', objectKey: data?.policyName || '',
        details: `VAT=${data?.vatRate}, GST=${data?.gstRate}, mileage=${data?.mileageRate}, hotel=${data?.hotelDailyLimit}, meal=${data?.mealDailyLimit}, receiptThreshold=${data?.receiptThreshold}`
      });
      LOG.info(`Policy '${data?.policyName}' updated by ${req.user.id}`);
    });

    // ─── Workflow Members: validate + audit (draft SAVE) ────────────────────
    this.before('SAVE', 'WorkflowMembers', (req) => {
      const w = req.data;
      const ok = (e) => e == null || e === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
      if (!ok(w.firstApprover) || !ok(w.secondApprover))
        return req.error(422, 'Approvers must be valid email addresses.');
    });

    this.after('SAVE', 'WorkflowMembers', async (data, req) => {
      await audit.record({
        userId: req.user.id, action: 'WorkflowChanged', objectType: 'ApprovalWorkflow', objectKey: data?.country || '',
        details: `L1=${data?.firstApprover || '-'}, L2=${data?.secondApprover || '-'}`
      });
      LOG.info(`Workflow for '${data?.country}' updated by ${req.user.id}`);
    });

    await super.init();
  }
};
