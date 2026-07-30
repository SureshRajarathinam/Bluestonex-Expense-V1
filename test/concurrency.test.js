// ─────────────────────────────────────────────────────────────────────────────
//  Concurrency & identity suite.
//
//  Documents two confirmed design gaps as `{ todo }` (they do not fail the suite;
//  a future fix flips them green):
//    D1 — no optimistic concurrency: mutable entities expose no ETag / honour no
//         If-Match, so concurrent edits silently lost-update.
//    D2 — claimNumber is generated from a global row COUNT with no DB uniqueness
//         constraint, so concurrent activations can collide (and a delete would
//         make the counter reuse an existing number).
//
//  NOTE: a true race is only reliably reproducible on real HANA (in-process
//  SQLite serialises); these tests assert the DESIRED invariant so the risk is
//  traceable regardless of whether the in-memory run happens to collide.
// ─────────────────────────────────────────────────────────────────────────────
const cds = require('@sap/cds');
const test = require('node:test');
const assert = require('node:assert/strict');

const EMP = { username: 'sabarinathan.chandrasekar@bluestonex.com', password: 'sab' };
const MGR = { username: 'manager@bluestonex.com', password: 'mgr' };

let baseURL;
cds.on('listening', (o) => { baseURL = (o.url || o); });
const t = cds.test(process.cwd());
let POST, GET;
test('setup', () => {
  t.axios.defaults.baseURL = (baseURL || '').replace('localhost', '127.0.0.1');
  t.axios.defaults.validateStatus = () => true;
  POST = (u, d, c) => t.axios.post(u, d, c);
  GET = (u, c) => t.axios.get(u, c);
});
const draft = (id) => `(ID=${id},IsActiveEntity=false)`;
const active = (id) => `(ID=${id},IsActiveEntity=true)`;

async function makeDraftWithItem() {
  const c = await POST('/expense/MyClaims', { country: 'UK', claimPeriod: '2026-02-28' }, { auth: EMP });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: '2026-02-16', expenseType_code: 'HOTEL', reasonForTrip: 'C', vatType: 'STD', grossAmount: 100, receiptAttached: true }, { auth: EMP });
  return id;
}

// ═══ D1 (DEFERRED) — full ETag needs If-Match plumbing in the freestyle UI ════
// A blanket @odata.etag breaks draftActivate (428) on these draft-enabled
// entities. Concurrency is mitigated meanwhile by draft locks (CON-03) + status
// guards. This stays todo until If-Match is wired through callAction.
test('D1: a mutable entity should expose an ETag for optimistic concurrency', { todo: 'ETag deferred — draft flow needs If-Match plumbing (D1)' }, async () => {
  const list = await GET('/approval/Policies', { auth: MGR });
  const id = list.data.value[0].ID;
  const r = await GET(`/approval/Policies(ID=${id},IsActiveEntity=true)`, { auth: MGR });
  assert.ok(r.headers.etag, 'a concurrency-safe entity must return an ETag header so If-Match can guard updates');
});

// ═══ D2 (FIXED) — claimNumber uniqueness under concurrent activation ══════════
test('D2 (fixed): concurrent draftActivate does not mint duplicate claimNumbers', async () => {
  const [a, b] = await Promise.all([makeDraftWithItem(), makeDraftWithItem()]);
  await Promise.all([
    POST(`/expense/MyClaims${draft(a)}/ExpenseService.draftActivate`, {}, { auth: EMP }),
    POST(`/expense/MyClaims${draft(b)}/ExpenseService.draftActivate`, {}, { auth: EMP })
  ]);
  const na = (await GET(`/expense/MyClaims${active(a)}`, { auth: EMP })).data.claimNumber;
  const nb = (await GET(`/expense/MyClaims${active(b)}`, { auth: EMP })).data.claimNumber;
  assert.notEqual(na, nb, `two claims must have distinct numbers (got ${na} and ${nb})`);
});

// ═══ Draft locking (green) — a second edit while a draft exists is controlled ══
test('DRAFT-LOCK: opening a second draft while one exists is rejected (409), not silently forked', async () => {
  const id = await makeDraftWithItem();
  await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth: EMP });
  const e1 = await POST(`/expense/MyClaims${active(id)}/ExpenseService.draftEdit`, { PreserveChanges: true }, { auth: EMP });
  assert.ok(e1.status < 400, `first draftEdit should succeed, got ${e1.status}`);
  const e2 = await POST(`/expense/MyClaims${active(id)}/ExpenseService.draftEdit`, { PreserveChanges: true }, { auth: EMP });
  assert.equal(e2.status, 409, `a second concurrent draftEdit must be 409, got ${e2.status}`);
});
