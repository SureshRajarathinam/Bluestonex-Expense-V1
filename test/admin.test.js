const cds = require('@sap/cds');
const test = require('node:test');
const assert = require('node:assert/strict');
const t = cds.test(process.cwd());
t.axios.defaults.validateStatus = () => true;

const ADMIN = { username: 'sabarinathan.chandrasekar@bluestonex.com', password: 'sab' };
const CLERK = { username: 'clerk@bluestonex.com', password: 'clerk' };

test('Admin: read policy, users, roles, audit, health', async () => {
  for (const e of ['Policies', 'Users', 'Roles', 'AuditLogs', 'SystemHealth']) {
    const r = await t.axios.get(`/admin/${e}`, { auth: ADMIN });
    assert.equal(r.status, 200, `${e} → ${r.status}`);
  }
});

test('Admin: metadata includes UI annotations for the admin apps', async () => {
  const xml = (await t.axios.get('/admin/$metadata', { auth: ADMIN })).data || '';
  assert.ok(xml.includes('LineItem'), 'admin metadata should carry UI.LineItem');
});

test('Admin RBAC: non-admin is blocked (403)', async () => {
  assert.equal((await t.axios.get('/admin/Policies', { auth: CLERK })).status, 403);
});

test('Admin: edit policy via draft persists and is audited', async () => {
  const id = (await t.axios.get('/admin/Policies', { auth: ADMIN })).data.value[0].ID;
  await t.axios.post(`/admin/Policies(ID=${id},IsActiveEntity=true)/AdminService.draftEdit`, { PreserveChanges: true }, { auth: ADMIN });
  await t.axios.patch(`/admin/Policies(ID=${id},IsActiveEntity=false)`, { mileageRate: 0.45 }, { auth: ADMIN });
  const act = await t.axios.post(`/admin/Policies(ID=${id},IsActiveEntity=false)/AdminService.draftActivate`, {}, { auth: ADMIN });
  assert.ok(act.status < 400, `activate ${act.status}`);
  const after = await t.axios.get(`/admin/Policies(ID=${id},IsActiveEntity=true)`, { auth: ADMIN });
  assert.equal(Number(after.data.mileageRate), 0.45);
  const logs = await t.axios.get(`/admin/AuditLogs?$filter=action eq 'PolicyChanged'`, { auth: ADMIN });
  assert.ok(logs.data.value.length > 0, 'policy change audited');
});

test('Admin: invalid policy rejected (mileage rate <= 0)', async () => {
  const id = (await t.axios.get('/admin/Policies', { auth: ADMIN })).data.value[0].ID;
  await t.axios.post(`/admin/Policies(ID=${id},IsActiveEntity=true)/AdminService.draftEdit`, { PreserveChanges: true }, { auth: ADMIN });
  await t.axios.patch(`/admin/Policies(ID=${id},IsActiveEntity=false)`, { mileageRate: 0 }, { auth: ADMIN });
  const act = await t.axios.post(`/admin/Policies(ID=${id},IsActiveEntity=false)/AdminService.draftActivate`, {}, { auth: ADMIN });
  assert.equal(act.status, 422, `should reject, got ${act.status}`);
});

test('Audit: workflow submit writes an audit entry', async () => {
  const c = await t.axios.post('/expense/MyClaims', { claimPeriod: '2026-07-01' }, { auth: ADMIN });
  const id = c.data.ID;
  await t.axios.post(`/expense/MyClaims(ID=${id},IsActiveEntity=false)/items`, { expenseDate: '2026-06-10', expenseType_code: 'TOLLS', reasonForTrip: 'Trip', vatType: 'STD', grossAmount: 5 }, { auth: ADMIN });
  await t.axios.post(`/expense/MyClaims(ID=${id},IsActiveEntity=false)/ExpenseService.draftActivate`, {}, { auth: ADMIN });
  await t.axios.post(`/expense/MyClaims(ID=${id},IsActiveEntity=true)/ExpenseService.submitClaim`, {}, { auth: ADMIN });
  const logs = await t.axios.get(`/admin/AuditLogs?$filter=action eq 'Submitted'`, { auth: ADMIN });
  assert.ok(logs.data.value.length > 0, 'submit audited');
});
