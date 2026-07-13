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
const BRAND = '#2a4b8d'; // BluestoneX blue (matches the app header)

// Key/value detail rows for the claim summary block.
const detailRows = (pairs) => pairs
  .filter(([, v]) => v != null && v !== '')
  .map(([k, v]) => `<tr>
      <td style="padding:7px 0;color:#6b7a90;font-size:13px;">${k}</td>
      <td style="padding:7px 0;color:#1a2b45;font-size:13px;font-weight:600;text-align:right;">${v}</td>
    </tr>`).join('');

// Full HTML shell: header band + card + intro + optional detail table + CTA line.
const emailShell = ({ heading, intro, rows, closing, accent }) => `<div style="margin:0;padding:0;background:#f4f6fa;">
  <div style="max-width:560px;margin:0 auto;padding:24px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="background:#ffffff;border:1px solid #e3e8f0;border-radius:12px;overflow:hidden;">
      <div style="background:${accent || BRAND};padding:16px 24px;">
        <span style="color:#ffffff;font-size:18px;font-weight:600;letter-spacing:.2px;">BluestoneX Expenses</span>
      </div>
      <div style="padding:24px;color:#1a2b45;">
        <h2 style="margin:0 0 14px;font-size:18px;line-height:1.3;color:#1a2b45;">${heading}</h2>
        <p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#3a4a63;">${intro}</p>
        ${rows && rows.length ? `<table style="width:100%;border-collapse:collapse;border-top:1px solid #eef1f6;border-bottom:1px solid #eef1f6;margin:0 0 20px;">${detailRows(rows)}</table>` : ''}
        <p style="margin:0;font-size:14px;line-height:1.55;color:#3a4a63;">${closing}</p>
      </div>
    </div>
    <p style="max-width:560px;margin:16px auto 0;padding:0 4px;font-size:12px;color:#8a97ab;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">This is an automated message from the BluestoneX Expense Reimbursement System — please do not reply.</p>
  </div>
</div>`;

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
      body: body.toString()
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
        body: JSON.stringify(payload)
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

  async notifyClaimSubmitted(claim, employee, firstApprover) {
    await this._sendEvent({
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
    await mailer.sendMail({
      to:      firstApprover,
      subject: `Expense Claim ${claim.claimNumber} awaiting your approval`,
      text:    `${employee.fullName} has submitted expense claim ${claim.claimNumber} ` +
               `for ${money(claim)}. Please review and approve it in the Approvals app.`,
      html:    emailShell({
        heading: `Expense claim ${claim.claimNumber} awaiting your approval`,
        intro:   `<strong>${employee.fullName}</strong> has submitted an expense claim for your review.`,
        rows:    [
          ['Claim number', claim.claimNumber],
          ['Employee',     employee.fullName],
          ['Amount',       money(claim)],
          ['Period',       claim.claimPeriod]
        ],
        closing: `Please review and approve it in the <strong>Approvals</strong> app.`
      })
    });
  }

  // Fired when a two-level (UK) claim clears level 1 and now awaits level 2.
  // `nextApprover` is the configured second-level approver ANS should alert.
  async notifyLevel1Approved(claim, nextApprover) {
    await this._sendEvent({
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
      subject: `Expense Claim ${claim.claimNumber} awaiting your second-level approval`,
      text:    `Claim ${claim.claimNumber} for ${money(claim)} has passed first-level ` +
               `approval and now awaits your second-level approval in the Approvals app.`,
      html:    emailShell({
        heading: `Expense claim ${claim.claimNumber} awaiting your second-level approval`,
        intro:   `This claim has cleared first-level approval and now needs your <strong>second-level</strong> sign-off.`,
        rows:    [
          ['Claim number', claim.claimNumber],
          ['Amount',       money(claim)]
        ],
        closing: `Please review and approve it in the <strong>Approvals</strong> app.`
      })
    });
  }

  async notifyManagerApproved(claim, managerUserId) {
    await this._sendEvent({
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
    await this._sendEvent({
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
    await this._sendEvent({
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
  async notifyReturned(claim, returnedBy, reason) {
    await this._sendEvent({
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
    // directory address (EXP_EMPLOYEES.Email, expanded by the reject handler) and
    // fall back to createdBy (their login) when the association is unresolved.
    const employeeEmail = (claim.employee && claim.employee.Email) || claim.createdBy;
    await mailer.sendMail({
      to:      employeeEmail,
      subject: `Expense Claim ${claim.claimNumber} returned for rework`,
      text:    `Your expense claim ${claim.claimNumber} has been returned by ${returnedBy}. ` +
               `Reason: ${reason || 'No reason provided'}. ` +
               `Please open the My Expenses app, fix the highlighted issues and re-apply for approval.`,
      html:    emailShell({
        accent:  '#b9541b', // amber/rust — this is an action-needed, not a success
        heading: `Expense claim ${claim.claimNumber} returned for rework`,
        intro:   `Your expense claim has been returned by <strong>${returnedBy}</strong> and needs changes before it can be approved.`,
        rows:    [
          ['Claim number', claim.claimNumber],
          ['Returned by',  returnedBy],
          ['Reason',       reason || 'No reason provided']
        ],
        closing: `Please open the <strong>My Expenses</strong> app, fix the highlighted issues and re-apply for approval.`
      })
    });
  }
}

module.exports = new NotificationService();
