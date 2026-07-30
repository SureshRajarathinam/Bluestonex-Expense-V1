'use strict';
// Gap coverage — pure unit tests (no server) for the notification/mailer/pdf
// libs and the new paging guard. These exercise the defensive "never throw"
// branches and the previously-dead notification methods.
const test = require('node:test');
const assert = require('node:assert/strict');

const notification = require('../srv/notification');
const mailer = require('../srv/lib/mailer');
const { renderClaimsPdf } = require('../srv/lib/pdf');
const { guardPaging } = require('../srv/lib/paging');

const CLAIM = { ID: 'x1', claimNumber: 'EXP-2026-9001', currency: 'GBP', totalGross: 42, claimPeriod: '2026-02-01', createdBy: 'emp@bluestonex.com' };

test('notification._sendEvent is a no-op (no throw) when ANS is not configured', async () => {
  const r = await notification._sendEvent({ subject: 'x', eventType: 'Test' });
  assert.equal(r, undefined, 'unconfigured ANS resolves to undefined without throwing');
});

test('notification.notifyClaimSubmitted never throws (mailer + ANS best-effort)', async () => {
  await assert.doesNotReject(() => notification.notifyClaimSubmitted(CLAIM, { fullName: 'Emp' }, 'mgr@bluestonex.com'));
});

test('previously-dead notification methods still run without throwing', async () => {
  // notifyManagerApproved/FinanceApproved/Settled are defined but not wired into
  // any handler — cover them so they cannot silently rot.
  await assert.doesNotReject(() => notification.notifyManagerApproved(CLAIM, 'mgr@bluestonex.com'));
  await assert.doesNotReject(() => notification.notifyFinanceApproved(CLAIM, 'fin@bluestonex.com'));
  await assert.doesNotReject(() => notification.notifySettled(CLAIM));
  await assert.doesNotReject(() => notification.notifyReturned(CLAIM, 'mgr@bluestonex.com', 'fix it'));
  await assert.doesNotReject(() => notification.notifyLevel1Approved(CLAIM, 'l2@bluestonex.com'));
});

test('mailer.sendMail is a no-op (no throw, returns falsy-safe) when unconfigured', async () => {
  // No SMTP_* / expense-mail / MAIL_DEV in the test env → logged no-op.
  await assert.doesNotReject(() => mailer.sendMail({ to: 'a@b.com', subject: 's', text: 't' }));
  await assert.doesNotReject(() => mailer.sendMail({ to: '', subject: 's', text: 't' }));
});

test('pdf.renderClaimsPdf returns a PDF buffer for rows and for an empty set', async () => {
  const rows = [{ claimNumber: 'EXP-2026-0001', status: 'Approved', country: 'UK', currency: 'GBP', totalGross: 120, employeeName: 'Emp', claimPeriod: '2026-02-01' }];
  const buf = await renderClaimsPdf(rows, { scope: 'history' });
  assert.ok(Buffer.isBuffer(buf) && buf.length > 0, 'returns a non-empty buffer');
  assert.equal(buf.slice(0, 5).toString('latin1'), '%PDF-', 'has the PDF magic header');
  const empty = await renderClaimsPdf([], { scope: 'approvals' });
  assert.ok(Buffer.isBuffer(empty) && empty.slice(0, 5).toString('latin1') === '%PDF-', 'empty set still renders a valid PDF');
});

test('guardPaging rejects malformed $top/$skip and passes valid/absent values', () => {
  const mkReq = (query) => {
    const calls = [];
    return { _: { req: { query } }, reject: (code, msg) => { calls.push({ code, msg }); return { code, msg }; }, _calls: calls };
  };
  let r = mkReq({ $top: '-1' }); guardPaging(r);
  assert.equal(r._calls[0]?.code, 400, 'negative $top rejected');
  r = mkReq({ $top: 'abc' }); guardPaging(r);
  assert.equal(r._calls[0]?.code, 400, 'non-numeric $top rejected');
  r = mkReq({ $skip: '-5' }); guardPaging(r);
  assert.equal(r._calls[0]?.code, 400, 'negative $skip rejected');
  r = mkReq({ $top: '10', $skip: '0' }); guardPaging(r);
  assert.equal(r._calls.length, 0, 'valid values pass');
  r = mkReq({}); guardPaging(r);
  assert.equal(r._calls.length, 0, 'absent values pass');
});
