'use strict';

const cds = require('@sap/cds');
const notification = require('./notification');
const audit = require('./lib/audit');
const { renderClaimsPdf } = require('./lib/pdf');

const LOG = cds.log('approval-service');

// Bound-action key: object {ID,...} for draft entities, raw scalar otherwise.
const idOf = (req) => { const p = req.params[0]; return p && typeof p === 'object' ? p.ID : p; };

module.exports = class ApprovalService extends cds.ApplicationService {

  async init() {
    const { CLAIMS, WORKFLOW, ITEMS, AUDITLOG } = cds.entities('EXP');

    // ─── Action: approve (country-aware: UK 2-level, India 1-level) ──────────
    this.on('approve', 'Approvals', async (req) => {
      const ID = idOf(req);
      const { comment } = req.data;
      const claim = await SELECT.one.from(CLAIMS, ID);
      if (!claim) return req.error(404, 'Expense claim not found.');

      const wf = await SELECT.one.from(WORKFLOW).where({ country: claim.country });
      if (!wf) return req.error(422, `No approval workflow is configured for ${claim.country}.`);

      const me = req.user.id;
      const now = new Date().toISOString();

      if (claim.status === 'Submitted') {
        if (me !== wf.firstApprover)
          return req.error(403, `You are not the first-level approver for ${claim.country}.`);

        if (claim.country === 'UK') {
          await UPDATE(CLAIMS, ID).with({
            status: 'FirstApproved', level1ApprovedBy: me, level1ApprovedAt: now, level1Comment: comment || ''
          });
          await audit.record({ userId: me, action: 'FirstApproved', objectType: 'ExpenseClaim', objectKey: claim.claimNumber, details: `Level 1 approved; awaiting level 2 (${wf.secondApprover || 'n/a'})` });
          // Alert the configured second-level approver that it now awaits them.
          await notification.notifyLevel1Approved(claim, wf.secondApprover);
        } else {
          await UPDATE(CLAIMS, ID).with({
            status: 'Approved', level1ApprovedBy: me, level1ApprovedAt: now, level1Comment: comment || ''
          });
          await audit.record({ userId: me, action: 'Approved', objectType: 'ExpenseClaim', objectKey: claim.claimNumber, details: `Single-level (India) approval complete` });
        }
      } else if (claim.status === 'FirstApproved') {
        if (me !== wf.secondApprover)
          return req.error(403, `You are not the second-level approver for ${claim.country}.`);
        await UPDATE(CLAIMS, ID).with({
          status: 'Approved', level2ApprovedBy: me, level2ApprovedAt: now, level2Comment: comment || ''
        });
        await audit.record({ userId: me, action: 'Approved', objectType: 'ExpenseClaim', objectKey: claim.claimNumber, details: `Level 2 approval complete` });
      } else {
        return req.error(409, `Claim ${claim.claimNumber} is not awaiting approval (status '${claim.status}').`);
      }

      LOG.info(`Claim ${claim.claimNumber} approved by ${me}`);
      return SELECT.one.from(CLAIMS, ID);
    });

    // ─── Action: reject ─────────────────────────────────────────────────────
    this.on('reject', 'Approvals', async (req) => {
      const ID = idOf(req);
      const { comment } = req.data;
      if (!comment?.trim()) return req.error(422, 'A rejection reason is required.');

      const claim = await SELECT.one.from(CLAIMS, ID);
      if (!claim) return req.error(404, 'Expense claim not found.');
      if (!['Submitted', 'FirstApproved'].includes(claim.status))
        return req.error(409, `Claim ${claim.claimNumber} cannot be rejected (status '${claim.status}').`);

      const wf = await SELECT.one.from(WORKFLOW).where({ country: claim.country });
      const me = req.user.id;
      const allowed =
        (claim.status === 'Submitted' && me === wf?.firstApprover) ||
        (claim.status === 'FirstApproved' && me === wf?.secondApprover);
      if (!allowed) return req.error(403, 'You are not the assigned approver for this claim.');

      // Decline = "return for rework": the claim goes back to the employee
      // (status Returned, reworkable) rather than to a terminal Rejected. Keep
      // rejectedBy/rejectionReason — they now record who returned it and why.
      await UPDATE(CLAIMS, ID).with({ status: 'Returned', rejectedBy: me, rejectionReason: comment });
      await notification.notifyReturned(claim, me, comment);
      await audit.record({ userId: me, action: 'Returned', objectType: 'ExpenseClaim', objectKey: claim.claimNumber, details: comment });

      LOG.info(`Claim ${claim.claimNumber} returned for rework by ${me}`);
      return SELECT.one.from(CLAIMS, ID);
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

    // ─── History enrichment: batch-fill attachmentCount + resubmitCount ──────
    // One SELECT over ITEMS and one over AUDITLOG for the whole page of rows
    // (NOT N+1). The virtual columns are null from the DB; we set them here.
    this.after('READ', 'ClaimHistory', async (rows) => {
      const list = Array.isArray(rows) ? rows : (rows ? [rows] : []);
      if (!list.length) return;
      const ids = list.map((r) => r.ID).filter(Boolean);
      const numbers = list.map((r) => r.claimNumber).filter(Boolean);

      const attCount = {};
      if (ids.length) {
        const items = await SELECT.from(ITEMS).columns('claim_ID')
          .where('receiptFileName is not null and claim_ID in', ids);
        for (const it of items) attCount[it.claim_ID] = (attCount[it.claim_ID] || 0) + 1;
      }
      const reCount = {};
      if (numbers.length) {
        const logs = await SELECT.from(AUDITLOG).columns('objectKey')
          .where({ objectKey: { in: numbers }, action: 'Resubmitted' });
        for (const l of logs) reCount[l.objectKey] = (reCount[l.objectKey] || 0) + 1;
      }
      for (const r of list) {
        r.attachmentCount = attCount[r.ID] || 0;
        r.resubmitCount = reCount[r.claimNumber] || 0;
      }
    });

    // ─── Function: claimJourney (Approver/Admin) — per-claim detail/timeline ──
    this.on('claimJourney', async (req) => {
      const { claimNumber } = req.data || {};
      if (!claimNumber) return req.error(400, 'A claim number is required.');

      const claim = await SELECT.one.from(CLAIMS)
        .columns((c) => { c('*'); c.employee((e) => { e('fullName'); e('employeeNumber'); }); })
        .where({ claimNumber });
      if (!claim) return req.error(404, 'Expense claim not found.');

      const wf = await SELECT.one.from(WORKFLOW).where({ country: claim.country });
      const logs = await SELECT.from(AUDITLOG).where({ objectKey: claimNumber }).orderBy('timestamp asc');
      const items = await SELECT.from(ITEMS)
        .columns((i) => { i('ID'); i('receiptFileName'); i('grossAmount'); i.expenseType((t) => { t('code'); t('description'); }); })
        .where('receiptFileName is not null and claim_ID =', claim.ID);

      return {
        claimNumber:    claim.claimNumber,
        employeeName:   (claim.employee && claim.employee.fullName) || claim.employee_ID || '',
        employeeNumber: (claim.employee && claim.employee.employeeNumber) || '',
        createdBy:      claim.createdBy || '',
        country:        claim.country || '',
        currency:       claim.currency || '',
        totalGross:     Number(claim.totalGross) || 0,
        assignedL1:     (wf && wf.firstApprover) || '',
        assignedL2:     (wf && wf.secondApprover) || '',
        approvedL1By:   claim.level1ApprovedBy || '',
        approvedL2By:   claim.level2ApprovedBy || '',
        returnedBy:     claim.rejectedBy || '',
        resubmitCount:  logs.filter((l) => l.action === 'Resubmitted').length,
        attachments:    items.map((it) => ({
          itemID:      it.ID,
          fileName:    it.receiptFileName || '',
          expenseType: (it.expenseType && it.expenseType.description) || it.expenseType_code || '',
          gross:       Number(it.grossAmount) || 0
        })),
        events: logs.map((l) => ({ action: l.action, at: l.timestamp, by: l.userId, note: l.details || '' }))
      };
    });

    // ─── Function: exportClaimsPdf (Approver/Admin) — returns PDF as base64 ────
    this.on('exportClaimsPdf', async (req) => {
      const d = req.data || {};
      const scope = d.scope === 'history' ? 'history' : 'approvals';

      let rows = await SELECT.from(CLAIMS)
        .columns((c) => { c('*'); c.employee((e) => { e('fullName'); }); })
        .orderBy('submittedAt desc');

      rows = rows.filter((r) => scope === 'history'
        ? r.status !== 'Draft'
        : ['Submitted', 'FirstApproved'].includes(r.status));
      if (d.status)  rows = rows.filter((r) => r.status === d.status);
      if (d.country) rows = rows.filter((r) => r.country === d.country);
      if (d.claimNo) rows = rows.filter((r) => (r.claimNumber || '').includes(d.claimNo));
      if (d.fromDate && d.toDate) {
        rows = rows.filter((r) => r.claimPeriod && r.claimPeriod >= d.fromDate && r.claimPeriod <= d.toDate);
      }

      const data = rows.map((r) => ({
        ...r,
        employeeName: (r.employee && r.employee.fullName) || r.employee_ID || '',
        decidedBy: r.level2ApprovedBy || r.level1ApprovedBy || r.rejectedBy || ''
      }));

      const buf = await renderClaimsPdf(data, {
        title: scope === 'history' ? 'Claim History' : 'Pending Approvals'
      });
      LOG.info(`exportClaimsPdf (${scope}) by ${req.user.id} — ${data.length} claim(s)`);
      return buf; // LargeBinary → base64 in the OData JSON response
    });

    // ─── Function: dashboardStats (Approver/Admin) — analytics aggregation ────
    // Read-only. Scopes non-draft claims by [fromDate,toDate] (on submittedAt,
    // falling back to claimPeriod) and by country ('ALL' | 'UK' | 'IN'), then
    // aggregates. Currencies are kept SEPARATE (GBP for UK, INR for India) — never
    // summed. spendByCountry is keyed by ISO alpha-2 (UK → GB, IN → IN) for the map.
    this.on('dashboardStats', async (req) => {
      const { fromDate, toDate, country } = req.data || {};
      const ymd = (d) => (d ? String(d).slice(0, 10) : null);
      const from = ymd(fromDate);
      const to = ymd(toDate);
      const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
      const isIN = (r) => r.country === 'IN';
      const isoOf = (r) => (r.country === 'IN' ? 'IN' : 'GB'); // UK → GB (ISO 3166 alpha-2)

      // Non-draft claims with employee dept + items (+ expense type) for grouping.
      let rows = await SELECT.from(CLAIMS).columns((c) => {
        c('ID'); c('status'); c('country'); c('currency'); c('totalGross');
        c('submittedAt'); c('claimPeriod');
        c.items((i) => { i('grossAmount'); i.expenseType((t) => { t('code'); t('description'); }); });
      });

      // "Declined" bucket = returned-for-rework (current flow) + legacy Rejected,
      // so the figure stays truthful across old and new data.
      const isDeclined = (r) => r.status === 'Returned' || r.status === 'Rejected';
      const dateOf = (r) => ymd(r.submittedAt) || ymd(r.claimPeriod);
      const inCountry = (r) => (!country || country === 'ALL') ? true : r.country === country;
      const inWindow = (r) => {
        const d = dateOf(r);
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      };
      rows = rows.filter((r) => r.status !== 'Draft' && inCountry(r) && inWindow(r));

      const awaiting = { UK: 0, IN: 0, total: 0 };
      const approved = { UK: 0, IN: 0, total: 0 };
      const rejected = { UK: 0, IN: 0, total: 0 };
      const reimbursed = { gbp: 0, inr: 0 };
      const catMap = new Map();
      const geoMap = new Map();
      const trendMap = new Map();

      for (const r of rows) {
        const g = Number(r.totalGross) || 0;
        const mk = (dateOf(r) || '').slice(0, 7);
        if (mk) {
          const t = trendMap.get(mk) || { month: mk, submitted: 0, approved: 0 };
          t.submitted += 1;
          if (r.status === 'Approved') t.approved += 1;
          trendMap.set(mk, t);
        }

        // Per-country (ISO) rollup for the geographic card — every in-window claim.
        const iso = isoOf(r);
        const gc = geoMap.get(iso) || { code: iso, country: r.country, claims: 0, approved: 0, awaiting: 0, rejected: 0, gbp: 0, inr: 0 };
        gc.claims += 1;
        if (r.status === 'Approved') { gc.approved += 1; if (isIN(r)) gc.inr += g; else gc.gbp += g; }
        else if (isDeclined(r)) gc.rejected += 1;
        else if (r.status === 'Submitted' || r.status === 'FirstApproved') gc.awaiting += 1;
        geoMap.set(iso, gc);

        if (r.status === 'Approved') {
          approved[isIN(r) ? 'IN' : 'UK'] += 1; approved.total += 1;
          if (isIN(r)) reimbursed.inr += g; else reimbursed.gbp += g;

          for (const it of (r.items || [])) {
            const code = (it.expenseType && it.expenseType.code) || it.expenseType_code || 'OTHER';
            const desc = (it.expenseType && it.expenseType.description) || code;
            const cat = catMap.get(code) || { code, description: desc, gbp: 0, inr: 0 };
            const ig = Number(it.grossAmount) || 0;
            if (isIN(r)) cat.inr += ig; else cat.gbp += ig;
            catMap.set(code, cat);
          }
        } else if (isDeclined(r)) {
          rejected[isIN(r) ? 'IN' : 'UK'] += 1; rejected.total += 1;
        } else if (r.status === 'Submitted' || r.status === 'FirstApproved') {
          awaiting[isIN(r) ? 'IN' : 'UK'] += 1; awaiting.total += 1;
        }
      }

      const fin = (arr) => arr
        .map((x) => ({ ...x, gbp: round2(x.gbp), inr: round2(x.inr) }))
        .sort((a, b) => (b.gbp + b.inr) - (a.gbp + a.inr));

      return {
        awaiting,
        approved,
        rejected,
        reimbursed: { gbp: round2(reimbursed.gbp), inr: round2(reimbursed.inr) },
        spendByCategory: fin([...catMap.values()]),
        spendByCountry: [...geoMap.values()].map((x) => ({ ...x, gbp: round2(x.gbp), inr: round2(x.inr) })),
        trend: [...trendMap.values()].sort((a, b) => (a.month < b.month ? -1 : 1))
      };
    });

    await super.init();
  }
};
