const cds = require('@sap/cds');
const test = require('node:test');
const assert = require('node:assert/strict');

// EMP (sab) does NOT match a seeded EXP_EMPLOYEES row → employee/payroll blank
// (used for the country-agnostic claim-number sequence). IN1 (suresh) DOES match
// a seed row (case-insensitive email) → employee-derived fields populate.
const EMP = { username: 'sabarinathan.chandrasekar@bluestonex.com', password: 'sab' };
const IN1 = { username: 'suresh.rajarathinam@bluestonex.com', password: 'suresh' };

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

// Create a draft claim + one item and activate it (which runs before('SAVE'),
// where the claim number is generated). Returns the active claim row.
async function makeClaim(country, period, auth) {
  const c = await POST('/expense/MyClaims', { country, claimPeriod: period }, { auth });
  const id = c.data.ID;
  await POST(`/expense/MyClaims${draft(id)}/items`, { expenseDate: period, expenseType_code: 'HOTEL', reasonForTrip: 'T', vatType: 'STD', grossAmount: 100, receiptAttached: true }, { auth });
  const act = await POST(`/expense/MyClaims${draft(id)}/ExpenseService.draftActivate`, {}, { auth });
  assert.ok(act.status < 400, `draftActivate ${act.status}: ${JSON.stringify(act.data?.error)}`);
  return (await GET(`/expense/MyClaims${active(id)}`, { auth })).data;
}

test('Req3: claim number is generated from the per-country Policy start value', async () => {
  // UK policy start = UKEXP1 → first UK claim UKEXP1, next UKEXP2 (fresh DB per file).
  const uk1 = await makeClaim('UK', '2026-03-15', EMP);
  const uk2 = await makeClaim('UK', '2026-03-16', EMP);
  assert.equal(uk1.claimNumber, 'UKEXP1', `first UK claim, got ${uk1.claimNumber}`);
  assert.equal(uk2.claimNumber, 'UKEXP2', `second UK claim, got ${uk2.claimNumber}`);
});

test('Req3: India uses its own start value (INEXP1) — prefixes never collide', async () => {
  const in1 = await makeClaim('IN', '2026-02-28', IN1);
  assert.equal(in1.claimNumber, 'INEXP1', `first India claim, got ${in1.claimNumber}`);
});

test('Req1: employee identity (number/site/payroll area) resolved from EXP_EMPLOYEES via whoami', async () => {
  // The New Expense Claim header is driven by whoami() — so it shows the employee
  // straight away on a brand-new draft (which has no persisted employee yet).
  // suresh matches a seed row: EmpID + BaseSiteKey INAUG (Site = Payroll Area).
  const who = (await GET('/expense/whoami()', { auth: IN1 })).data;
  assert.ok(/Suresh/i.test(who.fullName || ''), `whoami fullName, got ${who.fullName}`);
  assert.ok(who.employeeNumber, 'whoami employeeNumber (EmpID) resolved');
  assert.equal(who.site, 'INAUG', 'whoami site = employee Base Site');
  assert.equal(who.payrollArea, 'INAUG', 'whoami payroll area = employee Base Site');

  // On Save, the claim persists the Base-Site-derived payroll area + employee link.
  const act = await makeClaim('IN', '2026-02-15', IN1);
  assert.equal(act.payrollArea, 'INAUG', 'active claim: payroll area persisted from employee');
});

test('Req2: TaxTypes are country-aware (UK = VAT, India = GST)', async () => {
  const uk = (await GET(`/expense/TaxTypes?$filter=country eq 'UK'`, { auth: EMP })).data.value;
  const ind = (await GET(`/expense/TaxTypes?$filter=country eq 'IN'`, { auth: EMP })).data.value;
  assert.equal(uk.length, 3, 'UK has 3 tax types');
  assert.equal(ind.length, 3, 'India has 3 tax types');
  const ukStd = uk.find((r) => r.code === 'STD');
  const inStd = ind.find((r) => r.code === 'STD');
  assert.ok(/VAT|Standard Rate/i.test(ukStd.description), `UK STD is VAT, got "${ukStd.description}"`);
  assert.ok(/GST/i.test(inStd.description), `India STD is GST, got "${inStd.description}"`);
  assert.equal(Number(inStd.rate), 0.18, 'India GST standard rate is 0.18');
});
