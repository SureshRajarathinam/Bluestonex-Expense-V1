const cds = require('@sap/cds');
const test = require('node:test');
const assert = require('node:assert/strict');
const t = cds.test(process.cwd());
t.axios.defaults.validateStatus = () => true;

const ADMIN = { username: 'sabarinathan.chandrasekar@bluestonex.com', password: 'sab' };
const CLERK = { username: 'clerk@bluestonex.com', password: 'clerk' };

test('Admin: read policy, users, roles, audit', async () => {
  for (const e of ['Policies', 'Users', 'Roles', 'AuditLogs']) {
    const r = await t.axios.get(`/admin/${e}`, { auth: ADMIN });
    assert.equal(r.status, 200, `${e} → ${r.status}`);
  }
});

test('Admin RBAC: non-admin is blocked (403)', async () => {
  assert.equal((await t.axios.get('/admin/Policies', { auth: CLERK })).status, 403);
});

test('Policy: edit (direct PATCH) persists and is audited', async () => {
  const id = (await t.axios.get('/admin/Policies', { auth: ADMIN })).data.value[0].ID;
  const patch = await t.axios.patch(`/admin/Policies(${id})`, { mileageRate: 0.45 }, { auth: ADMIN });
  assert.ok(patch.status < 400, `patch ${patch.status}: ${JSON.stringify(patch.data?.error)}`);
  const after = await t.axios.get(`/admin/Policies(${id})`, { auth: ADMIN });
  assert.equal(Number(after.data.mileageRate), 0.45);
  const logs = await t.axios.get(`/admin/AuditLogs?$filter=action eq 'PolicyChanged'`, { auth: ADMIN });
  assert.ok(logs.data.value.length > 0, 'policy change audited');
});

test('Policy: invalid value rejected (mileage rate <= 0)', async () => {
  const id = (await t.axios.get('/admin/Policies', { auth: ADMIN })).data.value[0].ID;
  const patch = await t.axios.patch(`/admin/Policies(${id})`, { mileageRate: 0 }, { auth: ADMIN });
  assert.equal(patch.status, 422, `should reject, got ${patch.status}`);
});

test('User: create + edit role (direct), with email validation', async () => {
  // create
  const created = await t.axios.post('/admin/Users', { employeeNumber: '99', fullName: 'New Hire', email: 'new.hire@bluestonex.com', department: 'Sales', role: 'Employee', active: true }, { auth: ADMIN });
  assert.ok(created.status < 400, `create ${created.status}: ${JSON.stringify(created.data?.error)}`);
  const id = created.data.ID;
  // edit role
  const patch = await t.axios.patch(`/admin/Users(${id})`, { role: 'Manager' }, { auth: ADMIN });
  assert.ok(patch.status < 400, `patch ${patch.status}`);
  assert.equal((await t.axios.get(`/admin/Users(${id})`, { auth: ADMIN })).data.role, 'Manager');
  // invalid email rejected
  const bad = await t.axios.patch(`/admin/Users(${id})`, { email: 'not-an-email' }, { auth: ADMIN });
  assert.equal(bad.status, 422, `bad email should be 422, got ${bad.status}`);
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
