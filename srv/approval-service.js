'use strict';

const cds = require('@sap/cds');
const notification = require('./notification');
const audit = require('./lib/audit');
const { renderClaimsPdf } = require('./lib/pdf');
const { guardPaging } = require('./lib/paging');
const { callerIdentities, resolveEmployee } = require('./lib/identity');

const LOG = cds.log('approval-service');

// Title-case an email local-part ("jane.doe" → "Jane Doe") as a last-resort name.
const nameFromEmail = (email) => String(email || '').split('@')[0]
  .replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

// Bound-action key: object {ID,...} for draft entities, raw scalar otherwise.
const idOf = (req) => { const p = req.params[0]; return p && typeof p === 'object' ? p.ID : p; };

// Display name from a raw EMPLOYEES (USERS_MASTER-mirror) row: FName + ' ' + LName.
const empName = (e) => e ? [e.FName, e.LName].filter(Boolean).join(' ').trim() : '';

// True when the caller is the configured approver `email` (matched against any of
// their known identities, case-insensitively — see srv/lib/identity.js).
const isConfiguredApprover = (req, email) => !!email && callerIdentities(req).has(String(email).trim().toLowerCase());

module.exports = class ApprovalService extends cds.ApplicationService {

  async init() {
    const { CLAIMS, WORKFLOW, ITEMS, AUDITLOG, EMPLOYEES } = cds.entities('EXP');

    // Resolve an email to its employee full name (FName + LName), falling back to a
    // title-cased local-part. Used to name the notified recipient (e.g. the L2
    // approver) in the "email sent to X" toast — recipients are stored as emails.
    const fullNameForEmail = async (email) => {
      if (!email) return '';
      const emp = await SELECT.one.from(EMPLOYEES).columns('FName', 'LName').where({ Email: email });
      return empName(emp) || nameFromEmail(email);
    };

    // Full name of the ACTING user (the approver performing approve/reject). In Work
    // Zone req.user.id is the LOGON NAME, not an email — so fullNameForEmail(req.user.id)
    // misses the Email lookup and title-cases the logon ("srajarathinam" → "Srajarathinam").
    // Resolve identity-aware (email/logon/token claims) via resolveEmployee → FName+LName,
    // like submitClaim does; fall back to the email/local-part transforms.
    const myName = async (req) => {
      const emp = await resolveEmployee(req, EMPLOYEES);
      return empName(emp) || (await fullNameForEmail(req.user?.id)) || nameFromEmail(req.user?.id);
    };

    // Reject malformed $top/$skip (400) instead of silently ignoring them.
    this.before('READ', guardPaging);

    // ─── whoami: resolve the logged-in user's display name for the greeting ────
    // Identical logic to ExpenseService.whoami — matches EXP_EMPLOYEES by Email
    // (case-insensitive) via the shared source; falls back to the email local-part.
    this.on('whoami', async (req) => {
      const email = req.user?.id || '';
      let fullName = '';
      try {
        // Resolve by ANY caller identity (Work Zone id = logon name, not email).
        const emp = await resolveEmployee(req, EMPLOYEES);
        fullName = emp ? [emp.FName, emp.LName].filter(Boolean).join(' ').trim() : '';
      } catch (e) { LOG.warn('whoami lookup failed', e.message); }
      if (!fullName) fullName = nameFromEmail(email);
      const parts = fullName.trim().split(/\s+/).filter(Boolean);
      const firstName = parts.shift() || '';
      const lastName = parts.join(' ');
      return { email, fullName: fullName.trim(), firstName, lastName };
    });

    // ─── Function: approverFor(country, level) → approver full name ──────────
    // level 1 = first approver, 2 = second (UK only). Resolves the configured
    // WORKFLOW email to a full name so the UI can name who an email went to.
    this.on('approverFor', async (req) => {
      const { country, level } = req.data;
      if (!country) return null;
      const wf = await SELECT.one.from(WORKFLOW).where({ country });
      if (!wf) return null;
      const email = Number(level) === 2 ? wf.secondApprover : wf.firstApprover;
      return email ? fullNameForEmail(email) : null;
    });

    // ─── Action: approve (country-aware: UK 2-level, India 1-level) ──────────
    this.on('approve', 'Approvals', async (req) => {
      const ID = idOf(req);
      const { comment } = req.data;
      // Expand the claimant's directory email so a final-approval notification can
      // be addressed to the authoritative EXP_EMPLOYEES.Email (falls back to
      // createdBy inside notifyApproved when the association is unresolved).
      const claim = await SELECT.one.from(CLAIMS, ID, (c) => { c('*'); c.employee((e) => { e('Email'); e('FName'); e('LName'); }); });
      if (!claim) return req.error(404, 'Expense claim not found.');
      // Original claimant's display name for the L2 escalation email (falls back to
      // the login when the directory row is unresolved).
      const requestedBy = [claim.employee?.FName, claim.employee?.LName].filter(Boolean).join(' ') || claim.createdBy;

      const wf = await SELECT.one.from(WORKFLOW).where({ country: claim.country });
      if (!wf) return req.error(422, `No approval workflow is configured for ${claim.country}.`);

      const me = req.user.id;
      const now = new Date().toISOString();
      // Set true only when this action drives the claim to FINAL Approved (India
      // single level, or UK level 2) — NOT on UK FirstApproved.
      let finalApproved = false;

      // Authority to approve is governed SOLELY by Approval Workflow membership
      // (per requirement): whoever is configured as the country's approver may
      // approve, regardless of who created the claim — so a configured approver
      // can approve their own claim. The per-level checks below enforce that only
      // the configured first/second approver can act; everyone else gets 403.
      if (claim.status === 'Submitted') {
        if (!isConfiguredApprover(req, wf.firstApprover))
          return req.error(403, `You are not the first-level approver for ${claim.country}.`);

        if (claim.country === 'UK') {
          await UPDATE(CLAIMS, ID).with({
            status: 'FirstApproved', level1ApprovedBy: me, level1ApprovedAt: now, level1Comment: comment || ''
          });
          await audit.record({ userId: me, action: 'FirstApproved', objectType: 'ExpenseClaim', objectKey: claim.claimNumber, details: `Level 1 approved; awaiting level 2 (${wf.secondApprover || 'n/a'})` });
          // Alert the configured second-level approver (fire-and-forget — email must
          // not sit in the request's critical path; a dead SMTP would 504 the approve).
          const l2Name = await fullNameForEmail(wf.secondApprover);
          notification.notifyLevel1Approved(claim, wf.secondApprover, requestedBy, l2Name)
            .catch((e) => LOG.warn('notifyLevel1Approved failed:', e.message));
        } else {
          await UPDATE(CLAIMS, ID).with({
            status: 'Approved', level1ApprovedBy: me, level1ApprovedAt: now, level1Comment: comment || ''
          });
          await audit.record({ userId: me, action: 'Approved', objectType: 'ExpenseClaim', objectKey: claim.claimNumber, details: `Single-level (India) approval complete` });
          finalApproved = true;
        }
      } else if (claim.status === 'FirstApproved') {
        if (!isConfiguredApprover(req, wf.secondApprover))
          return req.error(403, `You are not the second-level approver for ${claim.country}.`);
        await UPDATE(CLAIMS, ID).with({
          status: 'Approved', level2ApprovedBy: me, level2ApprovedAt: now, level2Comment: comment || ''
        });
        await audit.record({ userId: me, action: 'Approved', objectType: 'ExpenseClaim', objectKey: claim.claimNumber, details: `Level 2 approval complete` });
        finalApproved = true;
      } else {
        return req.error(409, `Claim ${claim.claimNumber} is not awaiting approval (status '${claim.status}').`);
      }

      // On final approval, email the employee who created the claim (fire-and-forget —
      // email must not sit in the request's critical path; a dead SMTP would 504).
      if (finalApproved) {
        const meName = await myName(req);
        notification.notifyApproved(claim, me, meName)
          .catch((e) => LOG.warn('notifyApproved failed:', e.message));
      }

      LOG.info(`Claim ${claim.claimNumber} approved by ${me}`);
      return SELECT.one.from(CLAIMS, ID);
    });

    // ─── Action: reject ─────────────────────────────────────────────────────
    this.on('reject', 'Approvals', async (req) => {
      const ID = idOf(req);
      const { comment } = req.data;
      if (!comment?.trim()) return req.error(422, 'A rejection reason is required.');

      // Expand the claimant's directory email + name so the "returned" notification
      // can be addressed to the authoritative EXP_EMPLOYEES.Email (falls back to
      // createdBy inside notifyReturned when the association is unresolved) and the
      // email body / "email sent to X" toast can show the claimant's full name.
      const claim = await SELECT.one.from(CLAIMS, ID, (c) => { c('*'); c.employee((e) => { e('Email'); e('FName'); e('LName'); }); });
      if (!claim) return req.error(404, 'Expense claim not found.');
      if (!['Submitted', 'FirstApproved'].includes(claim.status))
        return req.error(409, `Claim ${claim.claimNumber} cannot be rejected (status '${claim.status}').`);

      const wf = await SELECT.one.from(WORKFLOW).where({ country: claim.country });
      const me = req.user.id;
      // Authority governed SOLELY by workflow membership (see approve): the
      // configured approver may return their own claim; anyone else gets 403.
      const allowed =
        (claim.status === 'Submitted' && isConfiguredApprover(req, wf?.firstApprover)) ||
        (claim.status === 'FirstApproved' && isConfiguredApprover(req, wf?.secondApprover));
      if (!allowed) return req.error(403, 'You are not the assigned approver for this claim.');

      // Decline = "return for rework": the claim goes back to the employee
      // (status Returned, reworkable) rather than to a terminal Rejected. Keep
      // rejectedBy/rejectionReason — they now record who returned it and why.
      await UPDATE(CLAIMS, ID).with({ status: 'Returned', rejectedBy: me, rejectionReason: comment });
      // Fire-and-forget email to the employee (see submit/approve — never block on SMTP).
      const meName = await myName(req);
      notification.notifyReturned(claim, me, comment, meName)
        .catch((e) => LOG.warn('notifyReturned failed:', e.message));
      await audit.record({ userId: me, action: 'Returned', objectType: 'ExpenseClaim', objectKey: claim.claimNumber, details: comment });

      LOG.info(`Claim ${claim.claimNumber} returned for rework by ${me}`);
      return SELECT.one.from(CLAIMS, ID);
    });

    // ─── Policy Configuration: validate + audit (draft SAVE) ────────────────
    this.before('SAVE', 'Policies', (req) => {
      const p = req.data;
      if (p.mileageRate != null && Number(p.mileageRate) <= 0)
        return req.error(422, 'Mileage rate must be greater than 0.');
      for (const [f, label] of [['hotelDailyLimit', 'Hotel daily limit'], ['mealDailyLimit', 'Meal daily limit']]) {
        if (p[f] != null && Number(p[f]) < 0) return req.error(422, `${label} cannot be negative.`);
      }
      // Tax rate is no longer a Policy field — it lives per treatment on TAX_TYPES.
    });

    this.after('SAVE', 'Policies', async (data, req) => {
      await audit.record({
        userId: req.user.id, action: 'PolicyChanged', objectType: 'ExpensePolicy', objectKey: data?.policyName || '',
        details: `mileage=${data?.mileageRate}, hotel=${data?.hotelDailyLimit}, meal=${data?.mealDailyLimit}`
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
        .columns((c) => { c('*'); c.employee((e) => { e('FName'); e('LName'); e('EmpID'); }); })
        .where({ claimNumber });
      if (!claim) return req.error(404, 'Expense claim not found.');

      const wf = await SELECT.one.from(WORKFLOW).where({ country: claim.country });
      const logs = await SELECT.from(AUDITLOG).where({ objectKey: claimNumber }).orderBy('timestamp asc');
      const items = await SELECT.from(ITEMS)
        .columns((i) => { i('ID'); i('receiptFileName'); i('grossAmount'); i.expenseType((t) => { t('code'); t('description'); }); })
        .where('receiptFileName is not null and claim_ID =', claim.ID);

      return {
        claimNumber:    claim.claimNumber,
        employeeName:   empName(claim.employee) || String(claim.employee_ID || ''),
        employeeNumber: (claim.employee && claim.employee.EmpID) || '',
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
        .columns((c) => { c('*'); c.employee((e) => { e('FName'); e('LName'); e('EmpID'); }); })
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
        employeeName: empName(r.employee) || String(r.employee_ID || ''),
        employeeNumber: (r.employee && r.employee.EmpID) || '',
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

      // Non-draft claims with claimant name + items (+ expense type) for grouping.
      let rows = await SELECT.from(CLAIMS).columns((c) => {
        c('ID'); c('status'); c('country'); c('currency'); c('totalGross');
        c('submittedAt'); c('claimPeriod'); c('createdBy'); c('policyFlags');
        c.employee((e) => { e('FName'); e('LName'); });
        c.items((i) => { i('grossAmount'); i.expenseType((t) => { t('code'); t('description'); }); });
      });

      // "Declined" bucket = returned-for-rework (current flow) + legacy Rejected,
      // so the figure stays truthful across old and new data.
      const isDeclined = (r) => r.status === 'Returned' || r.status === 'Rejected';
      // Dashboard date basis = the EXPENSE/TRAVEL period (claimPeriod), not the
      // submission date — so the Trend and every window-scoped figure reflect WHEN
      // the expense occurred. A Jan–Feb trip submitted in July lands in Jan/Feb,
      // not July. Falls back to submittedAt only if claimPeriod is somehow absent
      // (it is @mandatory, so that's just defensive).
      const dateOf = (r) => ymd(r.claimPeriod) || ymd(r.submittedAt);
      const inCountry = (r) => (!country || country === 'ALL') ? true : r.country === country;
      const inWindow = (r) => {
        const d = dateOf(r);
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      };
      // Country-scoped, all-time set (kept so the Policy Violation Rate card can
      // compare the selected window with the preceding equal-length window).
      const scoped = rows.filter((r) => r.status !== 'Draft' && inCountry(r));
      rows = scoped.filter(inWindow);

      // A claim is a policy violation if it carries a soft policy flag (the only
      // breach persisted on submitted claims — hard breaches block submission).
      const isFlagged = (r) => !!(r.policyFlags && String(r.policyFlags).trim());

      const awaiting = { UK: 0, IN: 0, total: 0 };
      const approved = { UK: 0, IN: 0, total: 0 };
      const rejected = { UK: 0, IN: 0, total: 0 };
      const catMap = new Map();   // APPROVED spend by category (bars + Total reimbursed spend donut)
      const geoMap = new Map();
      const trendMap = new Map();
      const claimantMap = new Map();  // claimant → APPROVED (reimbursed) amount (Top 5 claimants)

      // Accumulate one expense-item's gross into a category map (currency-separated).
      const addCat = (map, r, it) => {
        const code = (it.expenseType && it.expenseType.code) || it.expenseType_code || 'OTHER';
        const desc = (it.expenseType && it.expenseType.description) || code;
        const cat = map.get(code) || { code, description: desc, gbp: 0, inr: 0 };
        const ig = Number(it.grossAmount) || 0;
        if (isIN(r)) cat.inr += ig; else cat.gbp += ig;
        map.set(code, cat);
      };

      for (const r of rows) {
        const g = Number(r.totalGross) || 0;

        const mk = (dateOf(r) || '').slice(0, 7);
        if (mk) {
          const t = trendMap.get(mk) || { month: mk, submitted: 0, approved: 0, rejected: 0, flagged: 0, gbp: 0, inr: 0 };
          t.submitted += 1;
          // Policy-flagged claims per month — feeds the Policy Violation Rate sparkline
          // (monthly rate = flagged / submitted for that month).
          if (isFlagged(r)) t.flagged += 1;
          // Approved GROSS spend per month, currency-separated — feeds the wave card.
          if (r.status === 'Approved') { t.approved += 1; if (isIN(r)) t.inr += g; else t.gbp += g; }
          else if (isDeclined(r)) t.rejected += 1;
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
          // Approved-only category spend feeds BOTH the bars and the Top Expense Items donut.
          for (const it of (r.items || [])) addCat(catMap, r, it);
          // Top 5 claimants — APPROVED (reimbursed) amount per person only, so a
          // claimant surfaces on the card once their claim is approved.
          const nm = empName(r.employee) || r.createdBy || '—';
          const cm = claimantMap.get(nm) || { name: nm, gbp: 0, inr: 0 };
          if (isIN(r)) cm.inr += g; else cm.gbp += g;
          claimantMap.set(nm, cm);
        } else if (isDeclined(r)) {
          rejected[isIN(r) ? 'IN' : 'UK'] += 1; rejected.total += 1;
        } else if (r.status === 'Submitted' || r.status === 'FirstApproved') {
          awaiting[isIN(r) ? 'IN' : 'UK'] += 1; awaiting.total += 1;
        }
      }

      const fin = (arr) => arr
        .map((x) => ({ ...x, gbp: round2(x.gbp), inr: round2(x.inr) }))
        .sort((a, b) => (b.gbp + b.inr) - (a.gbp + a.inr));

      // ── Policy Violation Rate (flagged claims ÷ all claims in the window) ──
      const violTotal = rows.length;
      const violFlagged = rows.filter(isFlagged).length;
      const rate = violTotal ? violFlagged / violTotal : 0;
      // Top breach type, parsed from the flag text (meal vs hotel daily limit).
      let mealB = 0, hotelB = 0;
      for (const r of rows) {
        if (!isFlagged(r)) continue;
        const f = String(r.policyFlags);
        if (/meal/i.test(f)) mealB += 1;
        if (/hotel/i.test(f)) hotelB += 1;
      }
      const topBreach = (mealB === 0 && hotelB === 0) ? '—' : (hotelB > mealB ? 'Hotel daily limit' : 'Meal daily limit');
      // Delta vs the preceding equal-length window (same country scope).
      let deltaPts = null;
      if (from && to) {
        const dayMs = 86400000;
        const fromD = new Date(from), toD = new Date(to);
        const prevToD = new Date(fromD.getTime() - dayMs);
        const prevFromD = new Date(prevToD.getTime() - (toD - fromD));
        // Format the preceding-window bounds as ISO YYYY-MM-DD. ymd() (String(d).slice)
        // only works on ISO strings; on a Date it yields "Tue Jun 09", which would never
        // match dateOf(r) — so use toISOString(), keeping the UTC basis the arithmetic used.
        const pf = prevFromD.toISOString().slice(0, 10), pt = prevToD.toISOString().slice(0, 10);
        const prevRows = scoped.filter((r) => { const d = dateOf(r); return d && d >= pf && d <= pt; });
        if (prevRows.length) {
          const prevRate = prevRows.filter(isFlagged).length / prevRows.length;
          deltaPts = Math.round((rate - prevRate) * 1000) / 10; // percentage points, 1 dp
        }
      }
      const violation = {
        rate: Math.round(rate * 1000) / 10, // percentage, 1 dp
        flagged: violFlagged,
        total: violTotal,
        topBreach,
        deltaPts
      };

      return {
        violation,
        awaiting,
        approved,
        rejected,
        spendByCategory: fin([...catMap.values()]),
        topClaimants: fin([...claimantMap.values()]).slice(0, 5),
        spendByCountry: [...geoMap.values()].map((x) => ({ ...x, gbp: round2(x.gbp), inr: round2(x.inr) })),
        trend: [...trendMap.values()]
          .map((t) => ({ ...t, gbp: round2(t.gbp), inr: round2(t.inr) }))
          .sort((a, b) => (a.month < b.month ? -1 : 1))
      };
    });

    await super.init();
  }
};
