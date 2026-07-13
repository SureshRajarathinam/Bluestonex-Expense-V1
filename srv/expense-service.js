'use strict';

const cds = require('@sap/cds');
const notification = require('./notification');
const { splitVAT, mileageTotal, claimTotals, taxRateFor } = require('./lib/calc');
const { validateClaim } = require('./lib/validate');
const { loadValidationContext, today } = require('./lib/load-claim');
const audit = require('./lib/audit');
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
      // Employee-master fields for the New Expense Claim header (number/site/
      // payroll area). Payroll Area is the employee's Base Site (per config).
      let employeeNumber = '', site = '';
      try {
        const emp = await SELECT.one.from(EMPLOYEES).where(`lower(Email) =`, String(email).toLowerCase());
        if (emp) {
          fullName = [emp.FName, emp.LName].filter(Boolean).join(' ').trim();
          employeeNumber = emp.EmpID || '';
          site = emp.BaseSiteKey || '';
        }
      } catch (e) { LOG.warn('whoami lookup failed', e.message); }
      if (!fullName) fullName = nameFromEmail(email);
      const parts = fullName.trim().split(/\s+/).filter(Boolean);
      const firstName = parts.shift() || '';
      const lastName = parts.join(' ');
      return { email, fullName: fullName.trim(), firstName, lastName, employeeNumber, site, payrollArea: site };
    });

    // ─── Defaults: derive the employee from the logged-in user ─────────────
    // Employees never type their own ID — it comes from $user (the login).
    const applyDefaults = async (req) => {
      req.data.status   = req.data.status || 'Draft';
      req.data.currency = req.data.currency || 'GBP';
      // EXP_EMPLOYEES mirrors USERS_MASTER — match on Email (case-insensitive).
      const emp = await SELECT.one.from(EMPLOYEES).where(`lower(Email) =`, String(req.user?.id || '').toLowerCase());
      if (emp) {
        if (!req.data.employee_ID) req.data.employee_ID = emp.ID;
        // Payroll Area is fetched from the employee master (Base Site).
        if (!req.data.payrollArea) req.data.payrollArea = emp.BaseSiteKey;
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

      // Fallback: ensure the employee (and Base-Site-derived payroll area) are
      // set even if NEW didn't run.
      if (!claim.employee_ID && req.user?.id) {
        const emp = await SELECT.one.from(EMPLOYEES).where(`lower(Email) =`, String(req.user.id).toLowerCase());
        if (emp) {
          claim.employee_ID = emp.ID;
          if (!claim.payrollArea) claim.payrollArea = emp.BaseSiteKey;
        }
      }

      // Country drives tax (VAT for UK, GST for India) and currency
      const country = claim.country || 'UK';

      if (!claim.claimNumber) {
        // Config-driven Claim Number: the per-country Policy row carries the
        // starting value (e.g. 'UKEXP1' / 'INEXP1'). Split it into prefix +
        // trailing digits; the first claim for the country takes the seed, and
        // subsequent ones continue from the highest existing suffix for that
        // prefix (survives deletions; @assert.unique catches a concurrent dup).
        const startCfg = await SELECT.one.from(POLICY).columns('claimNumberStart').where({ country });
        const seed = (startCfg && startCfg.claimNumberStart) || `${country}EXP1`;
        const m = String(seed).match(/^(.*?)(\d+)$/);
        const prefix = m ? m[1] : seed;
        const startNum = m ? parseInt(m[2], 10) : 1;
        const width = m ? m[2].length : 0;
        const rows = await SELECT.from(CLAIMS).columns('claimNumber').where({ claimNumber: { like: `${prefix}%` } });
        let max = 0;
        for (const r of rows) {
          const s = String(r.claimNumber || '');
          if (!s.startsWith(prefix)) continue;
          const n = parseInt(s.slice(prefix.length), 10);
          if (Number.isFinite(n) && n > max) max = n;
        }
        const next = max ? max + 1 : startNum;
        claim.claimNumber = prefix + String(next).padStart(width, '0');
      }

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
      const { errors, warnings, flags } = validateClaim({ ...ctx, today: today() });
      if (errors.length)
        return req.error(422, `This claim cannot be submitted:\n• ${errors.join('\n• ')}`);
      // Non-blocking warnings (duplicates + soft daily-limit breaches) shown to the submitter.
      warnings.forEach((w) => req.warn(w));

      await UPDATE(CLAIMS, ID).with({
        status: 'Submitted',
        submittedAt: new Date().toISOString(),
        // Soft policy flags (daily-limit breaches) for the approver to see and
        // decide on; cleared to null when a resubmitted claim is within limits.
        policyFlags: (flags && flags.length) ? flags.join(' • ') : null
      });

      const employee = await SELECT.one.from(EMPLOYEES).where(`lower(Email) =`, String(req.user.id).toLowerCase());
      const employeeName = employee ? [employee.FName, employee.LName].filter(Boolean).join(' ').trim() : '';
      const wf = await SELECT.one.from(WORKFLOW).where({ country: claim.country });
      // Fire-and-forget: email/ANS must NEVER sit in the request's critical path. A
      // slow/unreachable SMTP would otherwise block the awaited submit long enough for
      // the approuter to 504. notifyClaimSubmitted is best-effort and self-logs.
      notification.notifyClaimSubmitted({ ...claim, status: 'Submitted' }, { fullName: employeeName || req.user.id }, wf?.firstApprover)
        .catch((e) => LOG.warn('notifyClaimSubmitted failed:', e.message));
      const sym = claim.currency === 'INR' ? '₹' : '£';
      // Distinguish a fresh submission from a rework resubmission so the History
      // timeline (and resubmitCount) can tell the two apart.
      await audit.record({ userId: req.user.id, action: wasReturned ? 'Resubmitted' : 'Submitted', objectType: 'ExpenseClaim', objectKey: claim.claimNumber, details: `Total ${sym}${claim.totalGross}` });

      LOG.info(`Claim ${claim.claimNumber} ${wasReturned ? 'resubmitted' : 'submitted'} by ${req.user.id}`);
      return SELECT.one.from(CLAIMS, ID);
    });

    // ─── Guard: only pre-submission claims may be deleted ──────────────────
    // The @restrict on MyClaims scopes DELETE to the owner but not by status, so
    // without this a Submitted/in-flight/Approved claim could be deleted via a
    // direct request — orphaning the approver queue and audit trail. Draft-discard
    // (no active row yet, or status 'Draft') passes through untouched.
    this.before('DELETE', 'MyClaims', async (req) => {
      const p = req.params[0];
      const ID = p && typeof p === 'object' ? p.ID : p;
      if (!ID) return;
      const claim = await SELECT.one.from(CLAIMS, ID).columns('status', 'claimNumber');
      if (claim && ['Submitted', 'FirstApproved', 'Approved'].includes(claim.status)) {
        return req.reject(409, `Claim ${claim.claimNumber} cannot be deleted — it is '${claim.status}'. Only Draft, Returned or Rejected claims can be deleted.`);
      }
    });

    // ─── Function: approverFor(country) ────────────────────────────────────
    // Returns the first-level approver email for a country, so the my-expenses
    // "Apply for Approval" confirmation popup can name who the claim will go to.
    // Read-only, Employee-callable; exposes only the recipient of your own claim.
    this.on('approverFor', async (req) => {
      const country = req.data.country;
      if (!country) return null;
      const wf = await SELECT.one.from(WORKFLOW).where({ country });
      return (wf && wf.firstApprover) || null;
    });

    await super.init();
  }
};
