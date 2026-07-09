'use strict';

const cds = require('@sap/cds');
const mailer = require('./lib/mailer');

const LOG = cds.log('notification');

// Currency-aware amount for email bodies (GBP for UK, INR for India).
const money = (claim) => `${claim.currency === 'INR' ? '₹' : '£'}${(claim.totalGross || 0).toFixed(2)}`;

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
               `for ${money(claim)}. Please review and approve it in the Approvals app.`
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
               `approval and now awaits your second-level approval in the Approvals app.`
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

    // Targeted email to the employee who owns the claim (createdBy = their login).
    await mailer.sendMail({
      to:      claim.createdBy,
      subject: `Expense Claim ${claim.claimNumber} returned for rework`,
      text:    `Your expense claim ${claim.claimNumber} has been returned by ${returnedBy}. ` +
               `Reason: ${reason || 'No reason provided'}. ` +
               `Please open the My Expenses app, fix the highlighted issues and re-apply for approval.`
    });
  }
}

module.exports = new NotificationService();
