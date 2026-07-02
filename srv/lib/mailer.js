'use strict';

const cds = require('@sap/cds');

const LOG = cds.log('mailer');

// Direct transactional email for approval alerts. The recipient is resolved
// per claim from the Approval Workflow config (first/second approver) by the
// caller, so each email goes to the right person — unlike ANS, which routes by
// static cockpit subscriptions.
//
// SMTP settings come from a bound service (label/name 'expense-mail') or, for
// local dev, SMTP_* env vars. With neither present the send is a logged no-op
// (mirrors the ANS "not configured — skipped" behaviour), so local runs and
// tests never send real mail and never fail. sendMail never throws — a mail
// failure must not roll back or break approve()/submitClaim().
class Mailer {

  _config() {
    // 1) Bound SMTP service (BTP user-provided service or destination-backed).
    try {
      const xsenv = require('@sap/xsenv');
      const creds = xsenv.serviceCredentials({ label: 'expense-mail' });
      if (creds && creds.host) return creds;
    } catch {
      /* not bound — fall through to env / no-op */
    }
    // 2) Local / CI via environment variables.
    if (process.env.SMTP_HOST) {
      return {
        host:   process.env.SMTP_HOST,
        port:   Number(process.env.SMTP_PORT) || 587,
        user:   process.env.SMTP_USER,
        pass:   process.env.SMTP_PASS,
        from:   process.env.SMTP_FROM,
        secure: process.env.SMTP_SECURE === 'true'
      };
    }
    return null;
  }

  async sendMail({ to, subject, text, html }) {
    if (!to) { LOG.info(`mail skipped — no recipient for "${subject}"`); return false; }

    const cfg = this._config();
    if (!cfg) { LOG.info(`mail not configured — skipped: "${subject}" → ${to}`); return false; }

    let nodemailer;
    try {
      nodemailer = require('nodemailer');
    } catch {
      LOG.warn('nodemailer not installed — mail skipped');
      return false;
    }

    try {
      const transport = nodemailer.createTransport({
        host:   cfg.host,
        port:   cfg.port || 587,
        secure: !!cfg.secure,
        auth:   cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined
      });
      await transport.sendMail({ from: cfg.from || cfg.user, to, subject, text, html });
      LOG.info(`mail sent: "${subject}" → ${to}`);
      return true;
    } catch (err) {
      // Never break the business flow because of a mail failure.
      LOG.error('mail send failed:', err.message);
      return false;
    }
  }
}

module.exports = new Mailer();
