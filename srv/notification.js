'use strict';

const cds = require('@sap/cds');
const mailer = require('./lib/mailer');

const LOG = cds.log('notification');

// Currency-aware amount for email bodies (GBP for UK, INR for India).
// NOTE: HANA returns DECIMAL columns as STRINGS ("20.00"), unlike SQLite which
// returns numbers — so totalGross must be coerced with Number() before toFixed,
// otherwise `"20.00".toFixed` throws and the whole notification (incl. the
// approver email) silently fails in production. SQLite masks this locally.
const money = (claim) => `${claim.currency === 'INR' ? '₹' : '£'}${Number(claim.totalGross || 0).toFixed(2)}`;

// ─── Branded HTML email builder ──────────────────────────────────────────────
// Email clients strip <style>/external CSS, so everything is INLINE. Kept small
// and table-free where possible for broad client support. `text` (plain) is
// always sent alongside as the fallback.
const BRAND = '#2a4b8d'; // BluestoneX blue (submitted / awaiting-approval accent)

// Work Zone launchpad base + per-app deep links for the email CTA button.
// Overridable via LAUNCHPAD_URL; falls back to the current TDD site.
// Work Zone site base for the email CTA. MUST include the site path (…/site/<siteId>)
// — the FLP shell that resolves an #Intent-action lives under /site, not host root
// (a hash on the bare host 404s "site not found"). Overridable via LAUNCHPAD_URL.
const LAUNCHPAD = process.env.LAUNCHPAD_URL || 'https://bsx-tdd-qq8akzjn.launchpad.cfapps.eu10.hana.ondemand.com/site/MyBSX';
const LINK = {
  approvals:  `${LAUNCHPAD}#ExpenseApproval-display`, // approver-facing emails
  myExpenses: `${LAUNCHPAD}#MyExpenses-display`       // employee-facing emails
};
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// Key/value detail rows for the claim summary grid (empty values dropped).
const detailRows = (pairs) => pairs
  .filter(([, v]) => v != null && v !== '')
  .map(([k, v]) => `<tr>
      <td style="padding:9px 0;color:#6b7a90;font-size:13px;padding-right:18px;white-space:nowrap;vertical-align:top;">${k}</td>
      <td style="padding:9px 0;color:#1a2b45;font-size:13px;font-weight:600;">${v}</td>
    </tr>`).join('');

// Solid accent CTA button (styled <a>; degrades to a plain link in Outlook desktop).
const ctaButton = (href, label, accent) =>
  `<a href="${href}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px;">${label}</a>`;

// Structured-Alert HTML shell (the approved template): accent header band → greeting
// → key/value grid → accent "section" callout → "Review Link" + CTA button → divided
// footer. Per requirement the LAYOUT/FIELDS are constant across statuses; only the
// accent COLOUR (and the status-specific wording) changes.
const emailShell = ({ title, greeting, rows, calloutHeading, callout, cta, accent }) => {
  const A = accent || BRAND;
  return `<div style="margin:0;padding:0;background:#f2f4f7;">
  <div style="max-width:560px;margin:0 auto;padding:24px;font-family:${FONT};">
    <div style="background:#ffffff;border:1px solid #e3e8f0;border-radius:12px;overflow:hidden;">
      <div style="background:${A};padding:22px 28px;">
        <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.2px;">${title}</span>
      </div>
      <div style="padding:26px 28px;color:#1a2b45;">
        <p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#3a4a63;">Dear <strong>${greeting}</strong>,</p>
        ${rows && rows.length ? `<table style="width:100%;border-collapse:collapse;">${detailRows(rows)}</table>` : ''}
        ${callout ? `<h3 style="margin:24px 0 10px;font-size:15px;color:${A};">${calloutHeading || 'Details'}</h3>
        <div style="background:#f5f7fb;border-left:4px solid ${A};border-radius:6px;padding:14px 16px;font-size:14px;color:#3a4a63;line-height:1.5;">${callout}</div>` : ''}
        ${cta ? `<p style="margin:24px 0 10px;font-size:13px;font-weight:700;color:#1a2b45;">Review Link:</p>${ctaButton(cta.href, cta.label, A)}` : ''}
      </div>
      <div style="border-top:1px solid #eef1f6;padding:16px 28px;">
        <p style="margin:0;font-size:12px;color:#8a97ab;text-align:center;">This is an automated message from <strong>BluestoneX Expenses</strong>.<br>Please do not reply.</p>
      </div>
    </div>
  </div>
</div>`;
};

// Wraps SAP BTP Alert Notification Service (ANS).
// In production: bind an `alert-notification` service instance to the app.
// In BTP Cockpit: configure Conditions + Email Actions + Subscriptions.
// Here we fire resource events; ANS routes them to the right recipients.

class NotificationService {

  constructor() {
    this._tokenCache = null;
  }

  // ─── Internal helpers ────────────────────────────────────────────────────

  _getCredentials() {
    try {
      const xsenv = require('@sap/xsenv');
      return xsenv.serviceCredentials({ label: 'alert-notification' });
    } catch {
      return null;
    }
  }

  async _getToken(credentials) {
    const now = Date.now();
    if (this._tokenCache && this._tokenCache.expiry > now) {
      return this._tokenCache.token;
    }

    const { client_id, client_secret, oauth_url } = credentials;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id,
      client_secret
    });

    const res = await fetch(`${oauth_url}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      // Bound the ANS token call — an unreachable/slow endpoint must not stall the
      // notification (this used to add ~1 min before the email went out).
      signal: AbortSignal.timeout(Number(process.env.ANS_TIMEOUT_MS) || 4000)
    });

    if (!res.ok) throw new Error(`ANS token request failed: ${res.status}`);

    const json = await res.json();
    this._tokenCache = {
      token: json.access_token,
      expiry: now + (json.expires_in - 60) * 1000
    };
    return this._tokenCache.token;
  }

  async _sendEvent(payload) {
    const credentials = this._getCredentials();
    if (!credentials) {
      LOG.info('ANS not configured — notification skipped:', payload.subject);
      return;
    }

    try {
      const token = await this._getToken(credentials);
      const url   = `${credentials.url}/cf/producer/v1/resource-events`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(Number(process.env.ANS_TIMEOUT_MS) || 4000)
      });

      if (!res.ok) {
        LOG.error('ANS event publish failed:', res.status, await res.text());
      } else {
        LOG.info('ANS event published:', payload.eventType);
      }
    } catch (err) {
      // Never crash the business flow because of a notification failure
      LOG.error('Notification error:', err.message);
    }
  }

  // ─── Business notification methods ───────────────────────────────────────

  async notifyClaimSubmitted(claim, employee, firstApprover, approverName) {
    this._sendEvent({
      eventType:    'ExpenseClaim.Submitted',
      resource: {
        resourceName:     claim.claimNumber,
        resourceType:     'ExpenseClaim',
        resourceInstance: claim.ID,
        tags: {
          employee:  employee.fullName,
          amount:    `${money(claim)}`,
          period:    claim.claimPeriod || '',
          // First-level approver so ANS can route the alert to the right person.
          approver:  firstApprover || ''
        }
      },
      severity: 'INFO',
      category: 'NOTIFICATION',
      subject:  `Expense Claim ${claim.claimNumber} Submitted for Approval`,
      body:     `${employee.fullName} has submitted expense claim ${claim.claimNumber} ` +
                `for ${money(claim)}. Please review and approve.`
    });

    // Targeted email to the configured first-level approver for this claim.
    const who = (employee && employee.fullName) || '';
    await mailer.sendMail({
      to:      firstApprover,
      subject: `Expense Claim ${claim.claimNumber}${who ? ` from ${who}` : ''} awaiting your approval`,
      text:    `${employee.fullName} has submitted expense claim ${claim.claimNumber} ` +
               `for ${money(claim)}. Please review and approve it in the Approvals app.`,
      html:    emailShell({
        accent:  BRAND, // blue — action needed
        title:   'Expense Claim Awaiting Approval',
        greeting: approverName || firstApprover,
        rows:    [
          ['Claim Number', claim.claimNumber],
          ['Requested By', employee.fullName],
          ['Amount',       money(claim)],
          ['Period',       claim.claimPeriod]
        ],
        calloutHeading: 'Request Details',
        callout: `<strong>${employee.fullName}</strong> has submitted a new expense claim for <strong>${money(claim)}</strong> and it is pending your approval.`,
        cta:     { href: LINK.approvals, label: 'Open in Approvals' }
      })
    });
  }

  // Fired when a two-level (UK) claim clears level 1 and now awaits level 2.
  // `nextApprover` is the configured second-level approver ANS should alert.
  // `requestedBy` is the original claimant's name, surfaced so the L2 approver
  // sees who raised the claim (optional — omitted gracefully if not supplied).
  async notifyLevel1Approved(claim, nextApprover, requestedBy, nextApproverName) {
    const who = requestedBy || '';
    this._sendEvent({
      eventType:    'ExpenseClaim.Level1Approved',
      resource: {
        resourceName:     claim.claimNumber,
        resourceType:     'ExpenseClaim',
        resourceInstance: claim.ID,
        tags: {
          amount:       `${money(claim)}`,
          nextApprover: nextApprover || ''
        }
      },
      severity: 'INFO',
      category: 'NOTIFICATION',
      subject:  `Expense Claim ${claim.claimNumber} — Level 1 Approved, Awaiting Level 2`,
      body:     `Claim ${claim.claimNumber} for ${money(claim)} has ` +
                `passed first-level approval and now awaits second-level approval from ` +
                `${nextApprover || 'the configured approver'}.`
    });

    // Targeted email to the configured second-level (UK) approver.
    await mailer.sendMail({
      to:      nextApprover,
      subject: `Expense Claim ${claim.claimNumber}${who ? ` from ${who}` : ''} awaiting your second-level approval`,
      text:    `Claim ${claim.claimNumber}${who ? ` from ${who}` : ''} for ${money(claim)} has passed first-level ` +
               `approval and now awaits your second-level approval in the Approvals app.`,
      html:    emailShell({
        accent:  BRAND, // blue — action needed
        title:   'Expense Claim Awaiting Second-Level Approval',
        greeting: nextApproverName || nextApprover,
        rows:    [
          ['Claim Number', claim.claimNumber],
          ['Requested By', who],
          ['Amount',       money(claim)]
        ],
        calloutHeading: 'Request Details',
        callout: `This claim${who ? ` from <strong>${who}</strong>` : ''} has cleared first-level approval and now needs your <strong>second-level</strong> sign-off.`,
        cta:     { href: LINK.approvals, label: 'Open in Approvals' }
      })
    });
  }

  async notifyManagerApproved(claim, managerUserId) {
    this._sendEvent({
      eventType: 'ExpenseClaim.ManagerApproved',
      resource: {
        resourceName:     claim.claimNumber,
        resourceType:     'ExpenseClaim',
        resourceInstance: claim.ID,
        tags: { approvedBy: managerUserId }
      },
      severity: 'INFO',
      category: 'NOTIFICATION',
      subject:  `Expense Claim ${claim.claimNumber} Approved by Line Manager`,
      body:     `Claim ${claim.claimNumber} for ${money(claim)} has been ` +
                `approved by the line manager and is now pending finance sign-off.`
    });
  }

  async notifyFinanceApproved(claim, financeUserId) {
    this._sendEvent({
      eventType: 'ExpenseClaim.FinanceApproved',
      resource: {
        resourceName:     claim.claimNumber,
        resourceType:     'ExpenseClaim',
        resourceInstance: claim.ID,
        tags: { approvedBy: financeUserId }
      },
      severity: 'INFO',
      category: 'NOTIFICATION',
      subject:  `Expense Claim ${claim.claimNumber} — Finance Approved`,
      body:     `Claim ${claim.claimNumber} for ${money(claim)} has ` +
                `received final finance approval. It will be included in the next payroll run.`
    });
  }

  async notifySettled(claim) {
    this._sendEvent({
      eventType: 'ExpenseClaim.Settled',
      resource: {
        resourceName:     claim.claimNumber,
        resourceType:     'ExpenseClaim',
        resourceInstance: claim.ID,
        tags: { amount: `${money(claim)}` }
      },
      severity: 'INFO',
      category: 'NOTIFICATION',
      subject:  `Expense Claim ${claim.claimNumber} Settled — ${money(claim)} Reimbursed`,
      body:     `Your expense claim ${claim.claimNumber} for ${money(claim)} ` +
                `has been settled and will appear in your next payroll.`
    });
  }

  // Fired when an approver declines a claim and sends it back for rework
  // (status → Returned). Alerts the employee (the claim's creator) so they can
  // fix and resubmit. `returnedBy` is the approver; `reason` is their comment.
  async notifyReturned(claim, returnedBy, reason, returnedByName) {
    // Greet the claimant by full name (FName + LName), falling back to their login.
    const employeeName = [claim.employee?.FName, claim.employee?.LName].filter(Boolean).join(' ').trim() || claim.createdBy || '';
    const returnedByDisplay = returnedByName || returnedBy;
    this._sendEvent({
      eventType: 'ExpenseClaim.Returned',
      resource: {
        resourceName:     claim.claimNumber,
        resourceType:     'ExpenseClaim',
        resourceInstance: claim.ID,
        tags: { returnedBy, reason: reason || '' }
      },
      severity: 'WARNING',
      category: 'NOTIFICATION',
      subject:  `Expense Claim ${claim.claimNumber} Returned for Rework`,
      body:     `Your expense claim ${claim.claimNumber} has been returned by ${returnedBy}. ` +
                `Reason: ${reason || 'No reason provided'}. ` +
                `Please review, make the necessary changes and re-apply for approval.`
    });

    // Targeted email to the employee who owns the claim. Prefer the authoritative
    // directory address (USERS_MASTER.Email, expanded by the reject handler) and
    // fall back to createdBy (their login) when the association is unresolved.
    const employeeEmail = (claim.employee && claim.employee.Email) || claim.createdBy;
    await mailer.sendMail({
      to:      employeeEmail,
      subject: `Expense Claim ${claim.claimNumber} returned for rework`,
      text:    `Your expense claim ${claim.claimNumber} has been returned by ${returnedBy}. ` +
               `Reason: ${reason || 'No reason provided'}. ` +
               `Please open the My Expenses app, fix the highlighted issues and re-apply for approval.`,
      html:    emailShell({
        accent:  '#b9541b', // rust — action needed, not a success
        title:   'Expense Claim Returned for Rework',
        greeting: employeeName,
        rows:    [
          ['Claim Number', claim.claimNumber],
          ['Returned By',  returnedByDisplay],
          ['Reason',       reason || 'No reason provided']
        ],
        calloutHeading: 'What to do next',
        callout: `Your expense claim has been returned by <strong>${returnedByDisplay}</strong> and needs changes before it can be approved. Please fix the highlighted issues and re-apply for approval.`,
        cta:     { href: LINK.myExpenses, label: 'Open in My Expenses' }
      })
    });
  }

  // Fired when a claim reaches FINAL approval (status → Approved): India after the
  // single level, UK after level 2. NOT fired on UK FirstApproved. Alerts the
  // employee (the claim's creator) that their claim is approved. `approvedBy` is
  // the approver who signed it off.
  async notifyApproved(claim, approvedBy, approvedByName) {
    // Greet the claimant by full name (FName + LName), falling back to their login.
    const employeeName = [claim.employee?.FName, claim.employee?.LName].filter(Boolean).join(' ').trim() || claim.createdBy || '';
    const approvedByDisplay = approvedByName || approvedBy;
    this._sendEvent({
      eventType: 'ExpenseClaim.Approved',
      resource: {
        resourceName:     claim.claimNumber,
        resourceType:     'ExpenseClaim',
        resourceInstance: claim.ID,
        tags: { approvedBy: approvedBy || '', amount: `${money(claim)}` }
      },
      severity: 'INFO',
      category: 'NOTIFICATION',
      subject:  `Expense Claim ${claim.claimNumber} Approved`,
      body:     `Your expense claim ${claim.claimNumber} for ${money(claim)} has been approved` +
                `${approvedBy ? ` by ${approvedBy}` : ''}. It will be processed for reimbursement.`
    });

    // Targeted email to the employee who owns the claim. Prefer the authoritative
    // directory address (USERS_MASTER.Email, expanded by the approve handler) and
    // fall back to createdBy (their login) when the association is unresolved.
    const employeeEmail = (claim.employee && claim.employee.Email) || claim.createdBy;
    await mailer.sendMail({
      to:      employeeEmail,
      subject: `Expense Claim ${claim.claimNumber} approved`,
      text:    `Good news — your expense claim ${claim.claimNumber} for ${money(claim)} has been approved` +
               `${approvedBy ? ` by ${approvedBy}` : ''}. It will be processed for reimbursement.`,
      html:    emailShell({
        accent:  '#2e7d52', // green — success/approval
        title:   'Expense Claim Approved',
        greeting: employeeName,
        rows:    [
          ['Claim Number', claim.claimNumber],
          ['Approved By',  approvedByDisplay],
          ['Amount',       money(claim)],
          ['Period',       claim.claimPeriod]
        ],
        calloutHeading: 'Approved',
        callout: `Good news — your expense claim has been <strong>approved</strong>${approvedByDisplay ? ` by <strong>${approvedByDisplay}</strong>` : ''} and will be processed for reimbursement. No further action is needed.`,
        cta:     { href: LINK.myExpenses, label: 'Open in My Expenses' }
      })
    });
  }
}

module.exports = new NotificationService();
