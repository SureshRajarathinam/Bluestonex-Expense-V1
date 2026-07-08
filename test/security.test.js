// ─────────────────────────────────────────────────────────────────────────────
//  Security & authorization suite — adversarial / negative-first.
//
//  Assumes every input hostile and every UI restriction bypassable. Tests the
//  authorization MATRIX (role × entity × verb), per-person approver identity,
//  and — most important — DIRECT-ODATA BYPASS: can a user reach data/actions the
//  UI hides by calling the service directly?
//
//  `{ todo: ... }` tests assert the DESIRED secure behaviour that the current
//  model does not enforce; they document confirmed authorization gaps (see the
//  Defect Report: D9 ApprovalItems/Mileage open, D10 MyClaimItems open) without
//  failing the suite. Everything else is green and confirms enforcement.
// ─────────────────────────────────────────────────────────────────────────────
const cds = require('@sap/cds');
const test = require('node:test');
const assert = require('node:assert/strict');

const EMP   = { username: 'sabarinathan.chandrasekar@bluestonex.com', password: 'sab' };  // all roles
const MGR   = { username: 'manager@bluestonex.com', password: 'mgr' };                    // UK L1
const CLERK = { username: 'clerk@bluestonex.com', password: 'clerk' };                    // Employee only
const PRIYA = { username: 'priya.sharma@bluestonex.com', password: 'priya' };             // Employee only (IN)

let baseURL;
cds.on('listening', (o) => { baseURL = (o.url || o); });
const t = cds.test(process.cwd());
let POST, GET, PATCH;
test('setup', () => {
  t.axios.defaults.baseURL = (baseURL || '').replace('localhost', '127.0.0.1');
  t.axios.defaults.validateStatus = () => true;
  POST = (u, d, c) => t.axios.post(u, d, c);
  GET = (u, c) => t.axios.get(u, c);
  PATCH = (u, d, c) => t.axios.patch(u, d, c);
});
const draft = (id) => `(ID=${id},IsActiveEntity=false)`;
const active = (id) => `(ID=${id},IsActiveEntity=true)`;

async function empClaimWithItem(reason = 'trip') {
  const c = await POST('/expense/MyClaims', { country: 'UK', claimPeriod: '2026-02-28' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', reasonForTrip: reason, vatType: 'STD', grossAmount: 120, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  return id;
}
async function submitUK() {
  const id = await empClaimWithItem('for approval');
  await POST(`/expense/MyClaims${active(id)}/ExpenseService.submitClaim`, {}, { auth: EMP });
  return id;
}

// ═══ PART A — authentication + role-to-entity authorization (expect enforced) ══
test('AUTH: unauthenticated request is rejected (401)', async () => {
  const r = await GET('/expense/MyClaims');
  assert.equal(r.status, 401, `no credentials must be 401, got ${r.status}`);
});
test('AUTHZ: employee-only user is blocked from Admin entities (Policies, WorkflowMembers → 403)', async () => {
  assert.equal((await GET('/approval/Policies', { auth: PRIYA })).status, 403);
  assert.equal((await GET('/approval/WorkflowMembers', { auth: PRIYA })).status, 403);
});
test('AUTHZ: employee-only user is blocked from the Approvals queue (403)', async () => {
  assert.equal((await GET('/approval/Approvals', { auth: PRIYA })).status, 403);
});
test('AUTHZ: value-help entities are readable by any authenticated user (by design)', async () => {
  assert.equal((await GET('/expense/Countries', { auth: CLERK })).status, 200);
  assert.equal((await GET('/expense/ExpenseTypes', { auth: CLERK })).status, 200);
  assert.equal((await GET('/expense/VATTypes', { auth: CLERK })).status, 200);
});

// ═══ PART B — action-level authorization + per-person identity ════════════════
test('AUTHZ: employee-only user cannot invoke approve/reject actions directly (403)', async () => {
  const id = await submitUK();
  const ap = await POST(`/approval/Approvals(${id})/ApprovalService.approve`, { comment: 'x' }, { auth: PRIYA });
  assert.equal(ap.status, 403, `employee-only approve must be 403, got ${ap.status}`);
  const rj = await POST(`/approval/Approvals(${id})/ApprovalService.reject`, { comment: 'x' }, { auth: PRIYA });
  assert.equal(rj.status, 403, `employee-only reject must be 403, got ${rj.status}`);
});
test('AUTHZ: PDF export blocked for employee-only user (403), allowed for approver', async () => {
  const url = "/approval/exportClaimsPdf(scope='history',status=null,country=null,claimNo=null,fromDate=null,toDate=null)";
  assert.equal((await GET(url, { auth: PRIYA })).status, 403);
  assert.ok((await GET(url, { auth: MGR })).status < 400);
});

// ═══ PART C — row-level scoping on MyClaims (own data only) ════════════════════
test('ROW-LEVEL: an employee cannot read another employee\'s claim by key (filtered → 404)', async () => {
  const id = await empClaimWithItem('sab-only');
  const asPriya = await GET(`/expense/MyClaims${active(id)}`, { auth: PRIYA });
  assert.ok(asPriya.status >= 400, `cross-employee claim read must be denied/filtered, got ${asPriya.status}`);
});
test('ROW-LEVEL: an employee cannot PATCH another employee\'s claim', async () => {
  const id = await empClaimWithItem('sab-patch');
  // must go through a draft to PATCH; priya cannot even open the draft on sab's claim
  const edit = await POST(`/expense/MyClaims${active(id)}/ExpenseService.draftEdit`, { PreserveChanges: true }, { auth: PRIYA });
  assert.ok(edit.status >= 400, `cross-employee draftEdit must be denied, got ${edit.status}`);
});

// ═══ PART D — INFORMATION EXPOSURE via @UI.Hidden (informational) ══════════════
test('INFO: @UI.Hidden employeeEmail is still selectable via OData (hidden != protected)', async () => {
  const id = await empClaimWithItem('hidden-field');
  const r = await GET(`/expense/MyClaims${active(id)}?$select=ID,employeeEmail`, { auth: EMP });
  assert.equal(r.status, 200);
  assert.ok('employeeEmail' in r.data, 'a @UI.Hidden field is not access-controlled — it is only visually hidden');
});

// ═══ PART E — DIRECT-ODATA BYPASS (desired-secure; documents confirmed gaps) ═══
// D10 (FIXED): MyClaimItems now carries the per-employee row filter, so the
// row-level security on MyClaims is no longer bypassable via the child set.
test('BYPASS D10 (fixed): MyClaimItems must not expose another employee\'s items', async () => {
  await empClaimWithItem('SECRET-REASON-D10');
  const asPriya = await GET('/expense/MyClaimItems', { auth: PRIYA });
  const leaked = (asPriya.data?.value || []).some((i) => i.reasonForTrip === 'SECRET-REASON-D10');
  assert.ok(!leaked, 'a different employee must not see this claim\'s items via MyClaimItems');
});
// Regression guard for the D10 fix: the OWNER must still reach their own items
// via MyClaimItems (the receipt media PUT uses this set directly).
test('D10 fix regression: the owner can still read their own items via MyClaimItems', async () => {
  await empClaimWithItem('OWN-ITEM-OK');
  const asOwner = await GET('/expense/MyClaimItems', { auth: EMP });
  assert.equal(asOwner.status, 200, `owner must still read own items, got ${asOwner.status}`);
  assert.ok((asOwner.data?.value || []).some((i) => i.reasonForTrip === 'OWN-ITEM-OK'), 'owner sees their own item');
});
// D9 (FIXED): ApprovalItems/ApprovalMileage are now Approver/Admin-only, so an
// employee-only account can no longer read org-wide transactional lines.
test('BYPASS D9 (fixed): employee-only user cannot read line items via /approval/ApprovalItems', async () => {
  await submitUK();
  const r = await GET('/approval/ApprovalItems', { auth: PRIYA });
  assert.ok(r.status === 403 || (r.data?.value || []).length === 0, `employee-only must not read org-wide line items, got ${r.status}`);
});

// ═══ PART F — CSRF (documented; not enforced under cds.test basic-auth) ════════
// CAP/the approuter enforce CSRF for state-changing verbs on cookie sessions;
// the in-process cds.test with stateless basic auth does not, so a meaningful
// negative test must run against `cds watch`/approuter — see test/expense.http.
test('CSRF: missing/invalid token on POST is rejected (verify against a deployed server)', { skip: 'not enforceable under cds.test basic-auth; covered in test/expense.http' }, () => {});
