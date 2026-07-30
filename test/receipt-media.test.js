'use strict';
// Gap coverage — receipt LargeBinary media: PUT/GET round-trip on a claim item,
// and row-level ownership (another employee cannot read it).
const cds = require('@sap/cds');
const test = require('node:test');
const assert = require('node:assert/strict');

const EMP = { username: 'sabarinathan.chandrasekar@bluestonex.com', password: 'sab' };
const OTHER = { username: 'priya.sharma@bluestonex.com', password: 'priya' };

let baseURL;
cds.on('listening', (o) => { baseURL = (o.url || o); });
const t = cds.test(process.cwd());

let POST, GET, PUT;
test('setup', () => {
  t.axios.defaults.baseURL = (baseURL || '').replace('localhost', '127.0.0.1');
  t.axios.defaults.validateStatus = () => true;
  POST = (u, d, c) => t.axios.post(u, d, c);
  GET = (u, c) => t.axios.get(u, c);
  PUT = (u, d, c) => t.axios.put(u, d, c);
});

const draft = (id) => `(ID=${id},IsActiveEntity=false)`;

async function makeItem(auth) {
  const c = await POST('/expense/MyClaims', { country: 'UK', claimPeriod: '2026-02-28' }, { auth });
  const id = c.data.ID;
  const item = await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', reasonForTrip: 'T', vatType: 'STD', grossAmount: 120 }, { auth });
  return item.data.ID;
}

test('receipt PUT then GET round-trips the bytes for the owner', async () => {
  const itemId = await makeItem(EMP);
  const url = `/expense/MyClaimItems(ID=${itemId},IsActiveEntity=false)/receipt`;
  const put = await PUT(url, 'hello-receipt', { auth: EMP, headers: { 'Content-Type': 'text/plain' } });
  assert.equal(put.status, 204, `receipt upload should be 204, got ${put.status}`);
  const get = await GET(url, { auth: EMP });
  assert.equal(get.status, 200);
  assert.equal(String(get.data), 'hello-receipt', 'the same bytes come back');
});

test('receipt is not readable by a different employee (row-level ownership)', async () => {
  const itemId = await makeItem(EMP);
  const url = `/expense/MyClaimItems(ID=${itemId},IsActiveEntity=false)/receipt`;
  await PUT(url, 'secret', { auth: EMP, headers: { 'Content-Type': 'text/plain' } });
  // The @restrict where 'claim.createdBy = $user' filters the row out for others,
  // so it reads as 404 (not found) rather than exposing the media.
  const get = await GET(url, { auth: OTHER });
  assert.equal(get.status, 404, `another employee must not read the receipt, got ${get.status}`);
});
