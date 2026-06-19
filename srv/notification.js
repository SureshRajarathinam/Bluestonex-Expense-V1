'use strict';

const cds = require('@sap/cds');

const LOG = cds.log('notification');

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

  async notifyClaimSubmitted(claim, employee) {
    await this._sendEvent({
      eventType:    'ExpenseClaim.Submitted',
      resource: {
        resourceName:     claim.claimNumber,
        resourceType:     'ExpenseClaim',
        resourceInstance: claim.ID,
        tags: {
          employee:  employee.fullName,
          amount:    `£${(claim.totalGross || 0).toFixed(2)}`,
          period:    claim.claimPeriod || ''
        }
      },
      severity: 'INFO',
      category: 'NOTIFICATION',
      subject:  `Expense Claim ${claim.claimNumber} Submitted for Approval`,
      body:     `${employee.fullName} has submitted expense claim ${claim.claimNumber} ` +
                `for £${(claim.totalGross || 0).toFixed(2)}. Please review and approve.`
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
      body:     `Claim ${claim.claimNumber} for £${(claim.totalGross || 0).toFixed(2)} has been ` +
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
      body:     `Claim ${claim.claimNumber} for £${(claim.totalGross || 0).toFixed(2)} has ` +
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
        tags: { amount: `£${(claim.totalGross || 0).toFixed(2)}` }
      },
      severity: 'INFO',
      category: 'NOTIFICATION',
      subject:  `Expense Claim ${claim.claimNumber} Settled — £${(claim.totalGross || 0).toFixed(2)} Reimbursed`,
      body:     `Your expense claim ${claim.claimNumber} for £${(claim.totalGross || 0).toFixed(2)} ` +
                `has been settled and will appear in your next payroll.`
    });
  }

  async notifyRejected(claim, rejectedBy, reason) {
    await this._sendEvent({
      eventType: 'ExpenseClaim.Rejected',
      resource: {
        resourceName:     claim.claimNumber,
        resourceType:     'ExpenseClaim',
        resourceInstance: claim.ID,
        tags: { rejectedBy, reason: reason || '' }
      },
      severity: 'WARNING',
      category: 'NOTIFICATION',
      subject:  `Expense Claim ${claim.claimNumber} Rejected`,
      body:     `Your expense claim ${claim.claimNumber} has been rejected by ${rejectedBy}. ` +
                `Reason: ${reason || 'No reason provided'}. ` +
                `Please review and resubmit.`
    });
  }
}

module.exports = new NotificationService();
