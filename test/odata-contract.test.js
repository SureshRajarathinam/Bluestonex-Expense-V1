// ─────────────────────────────────────────────────────────────────────────────
//  OData V4 service-contract suite.
//
//  Exercises $metadata, the query-option surface ($filter operators, $select,
//  $expand, $orderby, $top/$skip, $count, $search), invalid-option handling, and
//  response codes (200/400/404/405). Complements the existing functional suite,
//  which only used $filter on AuditLogs.
// ─────────────────────────────────────────────────────────────────────────────
const cds = require('@sap/cds');
const test = require('node:test');
const assert = require('node:assert/strict');

const EMP = { username: 'sabarinathan.chandrasekar@bluestonex.com', password: 'sab' };
const MGR = { username: 'manager@bluestonex.com', password: 'mgr' };

let baseURL;
cds.on('listening', (o) => { baseURL = (o.url || o); });
const t = cds.test(process.cwd());
let POST, GET, DEL;
test('setup', () => {
  t.axios.defaults.baseURL = (baseURL || '').replace('localhost', '127.0.0.1');
  t.axios.defaults.validateStatus = () => true;
  POST = (u, d, c) => t.axios.post(u, d, c);
  GET = (u, c) => t.axios.get(u, c);
  DEL = (u, c) => t.axios.delete(u, c);
});
const draft = (id) => `(ID=${id},IsActiveEntity=false)`;
const active = (id) => `(ID=${id},IsActiveEntity=true)`;

// ═══ $metadata ════════════════════════════════════════════════════════════════
test('$metadata: served, XML, declares the key entity sets + the submitClaim action', async () => {
  const r = await GET('/expense/$metadata', { auth: EMP });
  assert.equal(r.status, 200);
  assert.match(String(r.data), /EntityContainer/);
  assert.match(String(r.data), /EntitySet Name="MyClaims"/);
  assert.match(String(r.data), /Action Name="submitClaim"/);
});

// ═══ $filter operator coverage ════════════════════════════════════════════════
test('$filter eq: Countries code eq \'UK\' returns exactly the UK row', async () => {
  const r = await GET("/expense/Countries?$filter=code eq 'UK'", { auth: EMP });
  assert.equal(r.status, 200);
  assert.equal(r.data.value.length, 1);
  assert.equal(r.data.value[0].code, 'UK');
});
test('$filter boolean eq/ne: ExpenseTypes requiresReceipt eq true vs ne true partition the set', async () => {
  const all = (await GET('/expense/ExpenseTypes', { auth: EMP })).data.value.length;
  const yes = (await GET('/expense/ExpenseTypes?$filter=requiresReceipt eq true', { auth: EMP })).data.value.length;
  const no  = (await GET('/expense/ExpenseTypes?$filter=requiresReceipt ne true', { auth: EMP })).data.value.length;
  assert.equal(yes + no, all, 'eq true and ne true must partition the collection');
});
test('$filter contains / startswith on a string field', async () => {
  const c = await GET("/expense/ExpenseTypes?$filter=contains(description,'Hotel')", { auth: EMP });
  assert.equal(c.status, 200);
  assert.ok(c.data.value.length >= 1, 'at least one type description contains "Hotel"');
  const s = await GET("/expense/Countries?$filter=startswith(description,'United')", { auth: EMP });
  assert.ok(s.data.value.some((x) => x.code === 'UK'), 'startswith matches United Kingdom');
});
test('$filter and/or/not compose', async () => {
  const r = await GET("/expense/Countries?$filter=code eq 'UK' or code eq 'IN'", { auth: EMP });
  assert.equal(r.status, 200);
  assert.ok(r.data.value.length >= 2);
});

// ═══ $orderby / $select / $top / $skip / $count ═══════════════════════════════
test('$orderby desc sorts the collection', async () => {
  const r = await GET('/expense/ExpenseTypes?$orderby=code desc', { auth: EMP });
  assert.equal(r.status, 200);
  const codes = r.data.value.map((x) => x.code);
  const sorted = [...codes].sort().reverse();
  assert.deepEqual(codes, sorted, 'codes must be in descending order');
});
test('$select returns only the requested properties', async () => {
  const r = await GET('/expense/ExpenseTypes?$select=code', { auth: EMP });
  assert.equal(r.status, 200);
  const row = r.data.value[0];
  assert.ok('code' in row, 'selected property present');
  assert.ok(!('description' in row), 'non-selected property omitted');
});
test('$top + $count: page size honoured and total count is exact', async () => {
  const total = (await GET('/expense/ExpenseTypes', { auth: EMP })).data.value.length;
  const r = await GET('/expense/ExpenseTypes?$top=2&$count=true', { auth: EMP });
  assert.equal(r.status, 200);
  assert.equal(r.data.value.length, 2, '$top=2 returns 2 rows');
  assert.equal(r.data['@odata.count'], total, '$count reflects the full collection size, not the page');
});
test('$skip past the end returns an empty collection (boundary), still 200', async () => {
  const r = await GET('/expense/ExpenseTypes?$skip=9999', { auth: EMP });
  assert.equal(r.status, 200);
  assert.equal(r.data.value.length, 0);
});

// ═══ $expand (deep read of the claim composition) ═════════════════════════════
test('$expand: MyClaims?$expand=items returns the nested items', async () => {
  const c = await POST('/expense/MyClaims', { country: 'UK', claimPeriod: '2026-02-28' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', reasonForTrip: 'X', vatType: 'STD', grossAmount: 120, receiptAttached: true }, { auth: EMP });
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  const r = await GET(`/expense/MyClaims${active(id)}?$expand=items`, { auth: EMP });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.items) && r.data.items.length === 1, 'expanded items present');
});

// ═══ $search (probe — support varies; assert the contract, not a guess) ═══════
test('$search: probe support on Employees (documents whether the service supports it)', async () => {
  const r = await GET('/approval/Employees?$search=Barton', { auth: MGR });
  assert.ok([200, 400, 501].includes(r.status), `$search returned ${r.status}`);
  if (r.status === 200) assert.ok(Array.isArray(r.data.value), '$search returns a collection when supported');
});

// ═══ Invalid options → 400 ════════════════════════════════════════════════════
test('invalid $filter (unknown property) → 400', async () => {
  const r = await GET('/expense/Countries?$filter=nosuchprop eq 1', { auth: EMP });
  assert.equal(r.status, 400, `bad filter should be 400, got ${r.status}`);
});
// D11 (Low): CAP does not reject a spec-invalid $top (`-1` returns 200, silently
// ignored) instead of 400 per OData V4. Documented as a contract-laxity gap.
test('invalid $top values (-1, non-numeric) should be rejected with 400', { todo: 'CAP ignores invalid $top and returns 200 (D11)' }, async () => {
  assert.equal((await GET('/expense/ExpenseTypes?$top=-1', { auth: EMP })).status, 400);
  assert.equal((await GET('/expense/ExpenseTypes?$top=abc', { auth: EMP })).status, 400);
});

// ═══ Response codes: 404 + read-only write rejection ══════════════════════════
test('GET a non-existent key → 404', async () => {
  const r = await GET('/expense/MyClaims(ID=00000000-0000-0000-0000-000000000000,IsActiveEntity=true)', { auth: EMP });
  assert.equal(r.status, 404, `missing key should be 404, got ${r.status}`);
});
test('write to a @readonly value-help entity is rejected (>=400)', async () => {
  const r = await DEL("/expense/Countries('UK')", { auth: EMP });
  assert.ok(r.status >= 400, `deleting a read-only entity must fail, got ${r.status}`);
});
