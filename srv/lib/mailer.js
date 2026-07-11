'use strict';

const cds = require('@sap/cds');

const LOG = cds.log('mailer');

// Direct transactional email for approval alerts. The recipient is resolved
// per claim from the Approval Workflow config (first/second approver) by the
// caller, so each email goes to the right person — unlike ANS, which routes by
// static cockpit subscriptions.
//
// Config precedence:
//   1) a bound SMTP service (name/label 'expense-mail', or tag 'mail')
//   2) SMTP_* environment variables (local / CI)
//   3) MAIL_DEV=true  → a throwaway Ethereal test inbox; sends nothing real but
//      logs a preview URL you can open. Lets you quick-test without credentials.
//   4) none of the above → logged no-op (like ANS "not configured — skipped").
//
// sendMail never throws — a mail failure must not roll back or break
// approve()/submitClaim().
class Mailer {

  _boundConfig() {
    try {
      const xsenv = require('@sap/xsenv');
      for (const filter of [{ name: 'expense-mail' }, { label: 'expense-mail' }, { tag: 'mail' }]) {
        try {
          const c = xsenv.serviceCredentials(filter);
          if (c && c.host) return c;
        } catch { /* no match for this filter — try the next */ }
      }
    } catch { /* xsenv not available */ }
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

  // Lazily create (and cache) an Ethereal test account for MAIL_DEV mode.
  async _devConfig(nodemailer) {
    if (this._dev) return this._dev;
    const acc = await nodemailer.createTestAccount();
    this._dev = {
      host: 'smtp.ethereal.email', port: 587, secure: false,
      user: acc.user, pass: acc.pass, from: acc.user, _preview: true
    };
    LOG.info(`MAIL_DEV on — using Ethereal test inbox (${acc.user}); emails are captured, not delivered`);
    return this._dev;
  }

  async sendMail({ to, subject, text, html }) {
    if (!to) { LOG.info(`mail skipped — no recipient for "${subject}"`); return false; }

    let nodemailer;
    try {
      nodemailer = require('nodemailer');
    } catch {
      LOG.warn('nodemailer not installed — mail skipped');
      return false;
    }

    let cfg = this._boundConfig();
    if (!cfg && process.env.MAIL_DEV === 'true') {
      try { cfg = await this._devConfig(nodemailer); }
      catch (err) { LOG.error('MAIL_DEV setup failed:', err.message); return false; }
    }
    if (!cfg) { LOG.info(`mail not configured — skipped: "${subject}" → ${to}`); return false; }

    try {
      const transport = nodemailer.createTransport({
        host:   cfg.host,
        port:   cfg.port || 587,
        secure: !!cfg.secure,
        auth:   cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
        // Fail FAST on an unreachable/misconfigured SMTP. Without these, nodemailer's
        // defaults let a dead host hang the awaited caller (submit/approve) long enough
        // for the approuter to 504. Values overridable via MAIL_TIMEOUT_MS.
        connectionTimeout: Number(process.env.MAIL_TIMEOUT_MS) || 6000,
        greetingTimeout:   Number(process.env.MAIL_TIMEOUT_MS) || 6000,
        socketTimeout:     Number(process.env.MAIL_TIMEOUT_MS) || 8000
      });
      // Backstop race in case DNS/connect stalls before nodemailer's own timers engage.
      const hardMs = (Number(process.env.MAIL_TIMEOUT_MS) || 8000) + 2000;
      let timer;
      const guard = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`mail timeout after ${hardMs}ms`)), hardMs); });
      let info;
      try {
        info = await Promise.race([transport.sendMail({ from: cfg.from || cfg.user, to, subject, text, html }), guard]);
      } finally {
        clearTimeout(timer);
        if (transport && transport.close) { try { transport.close(); } catch { /* ignore */ } }
      }
      if (cfg._preview) {
        LOG.info(`mail (dev) "${subject}" → ${to} — preview: ${nodemailer.getTestMessageUrl(info)}`);
      } else {
        LOG.info(`mail sent: "${subject}" → ${to}`);
      }
      return true;
    } catch (err) {
      // Never break the business flow because of a mail failure.
      LOG.error('mail send failed:', err.message);
      return false;
    }
  }
}

module.exports = new Mailer();
