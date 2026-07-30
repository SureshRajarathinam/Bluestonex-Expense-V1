'use strict';
// Pure unit — mailer.js config precedence + transport options. No server, no
// network: nodemailer.createTransport and @sap/xsenv are stubbed so we assert
// the OPTIONS the mailer builds (host/secure/requireTLS/tls/auth) and that every
// path returns a boolean and never throws.
const test = require('node:test');
const assert = require('node:assert/strict');

const nodemailer = require('nodemailer');
const xsenv = require('@sap/xsenv');
const mailer = require('../srv/lib/mailer');

const origCreate = nodemailer.createTransport;
const origTestAcc = nodemailer.createTestAccount;
const origPreview = nodemailer.getTestMessageUrl;
const origSvcCreds = xsenv.serviceCredentials;

let captured, closed, sendBehavior;
function stubTransport() {
  captured = null; closed = false; sendBehavior = 'ok';
  nodemailer.createTransport = (opts) => {
    captured = opts;
    return {
      sendMail: async () => { if (sendBehavior === 'throw') throw new Error('smtp down'); return { messageId: 'test-id' }; },
      close: () => { closed = true; }
    };
  };
}

const SMTP_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_SECURE'];
const savedEnv = {};
// Clear the global MAIL_DISABLED kill-switch too (the test script sets it) so
// these stubbed-transport cases can exercise the real send paths; restored after.
function clearEnv() { SMTP_KEYS.concat('MAIL_DEV', 'MAIL_DISABLED').forEach((k) => { savedEnv[k] = process.env[k]; delete process.env[k]; }); }
function restoreEnv() { Object.keys(savedEnv).forEach((k) => { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }); }
const noBound = () => { throw new Error('no bound service'); };

test.before(() => { clearEnv(); xsenv.serviceCredentials = noBound; });
test.after(() => {
  nodemailer.createTransport = origCreate;
  nodemailer.createTestAccount = origTestAcc;
  nodemailer.getTestMessageUrl = origPreview;
  xsenv.serviceCredentials = origSvcCreds;
  restoreEnv();
});

test('returns false when there is no recipient (never builds a transport)', async () => {
  stubTransport();
  const r = await mailer.sendMail({ to: '', subject: 's', text: 't' });
  assert.equal(r, false);
  assert.equal(captured, null);
});

test('returns false (logged no-op) when nothing is configured', async () => {
  stubTransport();
  SMTP_KEYS.forEach((k) => delete process.env[k]); delete process.env.MAIL_DEV;
  const r = await mailer.sendMail({ to: 'a@b.com', subject: 's', text: 't' });
  assert.equal(r, false);
  assert.equal(captured, null);
});

test('SMTP_* env → STARTTLS transport (requireTLS on), auth, from defaults to user', async () => {
  stubTransport();
  process.env.SMTP_HOST = 'smtp.example.com'; process.env.SMTP_PORT = '587';
  process.env.SMTP_USER = 'u@x'; process.env.SMTP_PASS = 'pw'; process.env.SMTP_SECURE = 'false';
  const r = await mailer.sendMail({ to: 'a@b.com', subject: 's', text: 't' });
  assert.equal(r, true);
  assert.equal(captured.host, 'smtp.example.com');
  assert.equal(captured.port, 587);
  assert.equal(captured.secure, false);
  assert.equal(captured.requireTLS, true, 'STARTTLS enforced when not secure');
  assert.deepEqual(captured.auth, { user: 'u@x', pass: 'pw' });
  assert.equal(closed, true, 'transport closed after send');
  SMTP_KEYS.forEach((k) => delete process.env[k]);
});

test('SMTP_SECURE=true → secure transport, requireTLS off', async () => {
  stubTransport();
  process.env.SMTP_HOST = 'smtp.example.com'; process.env.SMTP_SECURE = 'true'; process.env.SMTP_PORT = '465';
  const r = await mailer.sendMail({ to: 'a@b.com', subject: 's', text: 't' });
  assert.equal(r, true);
  assert.equal(captured.secure, true);
  assert.equal(captured.requireTLS, false);
  SMTP_KEYS.forEach((k) => delete process.env[k]);
});

test('bound service wins over SMTP_* and its tls block is passed through', async () => {
  stubTransport();
  xsenv.serviceCredentials = (filter) => {
    if (filter && filter.name === 'expense-mail') {
      return { host: 'bound.smtp', port: 2525, user: 'bu', pass: 'bp', from: 'bound@x', secure: false, tls: { ciphers: 'TLSv1.2' } };
    }
    throw new Error('no match');
  };
  process.env.SMTP_HOST = 'ignored.example.com';
  const r = await mailer.sendMail({ to: 'a@b.com', subject: 's', text: 't' });
  assert.equal(r, true);
  assert.equal(captured.host, 'bound.smtp', 'bound service takes precedence');
  assert.deepEqual(captured.tls, { ciphers: 'TLSv1.2' }, 'tls block passed through');
  xsenv.serviceCredentials = noBound;
  delete process.env.SMTP_HOST;
});

test('MAIL_DEV=true → Ethereal test account, returns true', async () => {
  stubTransport();
  nodemailer.createTestAccount = async () => ({ user: 'dev@ethereal', pass: 'devpass' });
  nodemailer.getTestMessageUrl = () => 'https://ethereal.email/message/preview';
  process.env.MAIL_DEV = 'true';
  const r = await mailer.sendMail({ to: 'a@b.com', subject: 's', text: 't' });
  assert.equal(r, true);
  assert.equal(captured.host, 'smtp.ethereal.email');
  delete process.env.MAIL_DEV;
});

test('send failure is swallowed → returns false, never throws, transport still closed', async () => {
  stubTransport(); sendBehavior = 'throw';
  process.env.SMTP_HOST = 'smtp.example.com';
  let r;
  await assert.doesNotReject(async () => { r = await mailer.sendMail({ to: 'a@b.com', subject: 's', text: 't' }); });
  assert.equal(r, false);
  assert.equal(closed, true);
  delete process.env.SMTP_HOST;
});
