'use strict';
// Gap coverage — analytics functions: exportClaimsPdf filter branches + empty
// render, claimJourney bad-input/not-found, dashboardStats output contract.
const cds = require('@sap/cds');
const test = require('node:test');
const assert = require('node:assert/strict');

const MGR = { username: 'manager@bluestonex.com', password: 'mgr' };
const CLERK = { username: 'clerk@bluestonex.com', password: 'clerk' };

let baseURL;
cds.on('listening', (o) => { baseURL = (o.url || o); });
const t = cds.test(process.cwd());

let GET;
test('setup', () => {
  t.axios.defaults.baseURL = (baseURL || '').replace('localhost', '127.0.0.1');
  t.axios.defaults.validateStatus = () => true;
  GET = (u, c) => t.axios.get(u, c);
});

const pdfUrl = (o = {}) => `/approval/exportClaimsPdf(scope='${o.scope || 'history'}',status=${o.status || 'null'},country=${o.country || 'null'},claimNo=${o.claimNo || 'null'},fromDate=${o.fromDate || 'null'},toDate=${o.toDate || 'null'})`;

test('exportClaimsPdf: unfiltered history renders a PDF (200)', async () => {
  const r = await GET(pdfUrl({ scope: 'history' }), { auth: MGR });
  assert.equal(r.status, 200);
});

test('exportClaimsPdf: status+country filter branch renders (200)', async () => {
  const r = await GET(pdfUrl({ scope: 'history', status: "'Approved'", country: "'UK'" }), { auth: MGR });
  assert.equal(r.status, 200);
});

test('exportClaimsPdf: a filter that matches nothing still renders a valid PDF (200)', async () => {
  const r = await GET(pdfUrl({ scope: 'approvals', claimNo: "'NOPE-9999'" }), { auth: MGR });
  assert.equal(r.status, 200, 'empty result set renders an (empty) PDF, not an error');
});

test('exportClaimsPdf: employee (no Approver/Admin) is forbidden (403)', async () => {
  const r = await GET(pdfUrl({ scope: 'history' }), { auth: CLERK });
  assert.equal(r.status, 403);
});

test('claimJourney: missing claimNumber → 400', async () => {
  const r = await GET(`/approval/claimJourney(claimNumber='')`, { auth: MGR });
  assert.equal(r.status, 400);
});

test('claimJourney: unknown claimNumber → 404', async () => {
  const r = await GET(`/approval/claimJourney(claimNumber='NOPE-9999')`, { auth: MGR });
  assert.equal(r.status, 404);
});

test('dashboardStats: output contract (counts numeric, topClaimants capped at 5, arrays present)', async () => {
  const r = await GET(`/approval/dashboardStats(fromDate=null,toDate=null,country=null)`, { auth: MGR });
  assert.equal(r.status, 200);
  const d = r.data;
  for (const k of ['awaiting', 'approved', 'rejected']) {
    // Each count is a per-country breakdown { UK, IN, total }.
    assert.equal(typeof d[k]?.total, 'number', `${k}.total is a number`);
    assert.equal(typeof d[k]?.UK, 'number', `${k}.UK is a number`);
    assert.equal(typeof d[k]?.IN, 'number', `${k}.IN is a number`);
  }
  assert.ok(Array.isArray(d.topClaimants) && d.topClaimants.length <= 5, 'topClaimants is capped at 5');
  assert.ok(Array.isArray(d.spendByCategory), 'spendByCategory is an array');
  assert.ok(Array.isArray(d.spendByCountry), 'spendByCountry is an array');
  assert.ok(Array.isArray(d.trend), 'trend is an array');
});

test('dashboardStats: employee (no Approver/Admin) is forbidden (403)', async () => {
  const r = await GET(`/approval/dashboardStats(fromDate=null,toDate=null,country=null)`, { auth: CLERK });
  assert.equal(r.status, 403);
});
