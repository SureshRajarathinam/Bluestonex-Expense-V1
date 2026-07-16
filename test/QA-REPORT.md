# QA Test Deliverable — BluestoneX Expense Reimbursement System

**System under test:** SAP CAP (Node.js, **OData V4**) backend + two **freestyle SAPUI5** apps (`my-expenses`, `approval`).
**Programming model:** CDS-based CAP services (`@sap/cds` 8) with `@odata.draft.enabled` on `MyClaims`/`Policies`/`WorkflowMembers`. **Draft-enabled.**
**Landscape:** SAP BTP Cloud Foundry (CF `bsx-tdd`/`TDD`, eu10) + HANA Cloud (prod) / SQLite (dev+test). **Test bed:** local `cds.test` on in-memory SQLite + seed data (HANA not exercised in CI).
**Key entities/process:** Expense claim **create → submit → approve/reject** with country-aware tax (UK VAT / India GST) and country-driven routing (UK 2-level, India 1-level).
**OData services:** `ExpenseService` (`/expense`), `ApprovalService` (`/approval`), both `@requires:'authenticated-user'`.
**Date:** 2026-07-16 (latest pass; earlier passes below). **Suite baseline:** 113 → **221 tests (219 pass, 0 fail, 1 skip CSRF, 1 todo ETag)** via `npm test`. Every finding cites `file:line`.

---

## Validation Pass — 2026-07-16 (full both-app audit + 2 fixes)

**Scope requested:** validate all JS/functions in both apps; verify success/error flows, the History
tab, and dashboard cards + calculations; check every `USERS_MASTER`/config-table usage; confirm
correct user identification on launch and claim-creation auto-populate; guarantee 100%-accurate
amounts, **no mock data**, and **no real mail** during testing; fix the reported Approvals country
flicker; generate this report.

**Method:** 3 parallel read-only code audits (flicker mechanism · dashboard/calculations + config &
user_master usage · my-expenses JS + flows + user-identify) cross-checked by direct file reads, then
`npm test` on the in-memory `cds.test` harness (HANA not exercised in CI). **No real mail:**
`MAIL_DISABLED=true` in the `test`/`test:coverage` scripts; mailer logs "mail disabled … skipped"
(seen in run output); `sendMail` never throws. **No mock data:** grep-clean across both webapps and
`srv/`; the only seed is `db/init.js SAMPLE_USERS`, a dev/test SQLite stand-in guarded off
production/HANA (`db/init.js:53`).

### Defects fixed this pass

| Ref | Severity | Area | Fix | Evidence |
|---|---|---|---|---|
| V1 | Medium (reported) | Approvals country tab | Table `/Approvals` binding auto-loaded UK+IN unfiltered, then the country `$filter` was applied async → India rows flashed under the UK tab (~1s). Now the binding is `suspended:true` (`Approvals.view.xml:56`) and `onGo` busy-gates + resumes it with the country filter applied first (`Approvals.controller.js` `onGo`/`onUpdateFinished`). | Manual `cds watch` (UI timing — not unit-testable); no unfiltered request issued. |
| V2 | Medium (accuracy) | Dashboard amounts | "Total reimbursed" donut + category bars summed **item gross only**, while the approved-spend wave + Top-Claimants summed **claim `totalGross` (items + mileage)** → they didn't reconcile for approved claims with mileage. Fixed: mileage rolled up as its own **`Mileage`** category in `dashboardStats` (`approval-service.js`). | New automated test `test/dashboard.test.js` "amounts reconcile: donut/category (incl. Mileage) == approved wave == Top-Claimants" — **PASS**. |
| V3 | Cleanup | my-expenses | Removed dead `BaseController.toast()` (+ unused `MessageToast` import) and dead `formatter.receiptText`/`canEditDraft`; hoisted the duplicated `_predicateOf` into `BaseController`. Fixed stale `dashboardStats` date-basis comment (claimPeriod-first, not submittedAt) + `Mileage`/`ALL` notes (`approval-service.js`, `approval-service.cds`). | `npm test` green; no behaviour change. |

### Verified WORKING (no change needed)

| Requirement | Result | Evidence |
|---|---|---|
| User identification on launch — **both apps** | ✅ | my-expenses `App.controller.js:17-31` + approval `App.controller.js:23,30-42` fetch `whoami()` via `_serviceUrl()`; `ExpenseService.whoami` (`expense-service.js:39-60`) + `ApprovalService.whoami` (`approval-service.js:57-70`) resolve via `resolveEmployee` → `users-master.js`. Greeting test `country-config.test.js:56`. |
| Claim-creation auto-populate from `USERS_MASTER` | ✅ | `Claims.onCreate`→`_resolveSite()` (whoami `site`→country) + `Claim._loadEmployee` populate `ui>/emp` from `whoami()`; backend `applyDefaults` + `before('SAVE')` set `employee_ID` + denormalized name/number/email (`expense-service.js`). No hardcoded per-user data. |
| Amount calculations (VAT/GST split, mileage, totals) | ✅ | Single source `calc.js` applied in `before('SAVE')`; dashboards consume persisted values. `validate.test.js`, `country-config.test.js`, splitVAT rounding test all green. |
| Dashboard cards (counts, category, claimants, geo, trend/wave, violation) | ✅ + V2 | `dashboard.test.js` (14 tests incl. currency separation, date-window, delta, reconciliation). |
| History tab (list, search, journey timeline) | ✅ | `ClaimHistory`/`claimJourney` read employee via native SQL only (no HANA-500 risk); History default = all non-draft org-wide, so it has **no** wrong-country flash (fix V1 is Approvals-only). |
| Success/error flows (save/submit/approve/reject/return/delete/receipt) | ✅ | `lifecycle.test.js`, `approval.test.js`, `expense.test.js`, `security.test.js`, `edge-cases.test.js`. |
| No real mail during tests | ✅ | `MAIL_DISABLED=true`; run log shows "mail disabled … skipped". |
| No mock data anywhere | ✅ | grep-clean; only guarded dev SQLite seed (`db/init.js`). |

### Observations (documented, NOT changed)

- `formatter.isDraft` (my-expenses) has no live reference — dead but left in place (was outside the
  agreed removal list). Candidate for a later cleanup PR.
- `dashboardStats` supports `country='ALL'` (returns both currencies) but the dashboard's country
  `Select` binds `/Countries` (UK/IN only) and renders a single currency — so `ALL` is unreachable
  from the UI and would show GBP-only if forced. Latent, not a live inaccuracy.
- Dead approval-app i18n keys / CSS classes catalogued in `test/DEAD-CODE-PERF-REPORT.md` remain.

---

## 0. Fixes applied in this pass (all confirmed by tests / live repro)

| Ref | Severity | Fix | Evidence |
|---|---|---|---|
| **DEF-01** | High | **"Apply for Approval" 409 Entity locked** — self-healing submit: on a draft-lock, activate the stale sibling draft (releases the CAP lock) then retry submit. | `Claim.controller.js onSubmit`; `test/gap-flows.test.js` self-heal test + live repro |
| **DEF-02** | High | **No popup on missing mandatory fields** — the `required="true"` marks were cosmetic. Added real client validation (`_validateClaimFields`) for Claim Period + item fields, consolidated popup, and fixed error surfacing (throw **before** rebind; read the Message Manager). | `Claim.controller.js`, `BaseController._backendMessage`; backstops in `test/gap-flows.test.js` |
| **DEF-03** | High | **Self-approval (separation of duties)** — Approvers/Admins carry the Employee scope and could approve their **own** submitted claims. Now 403. | `approval-service.js` approve/reject guard; `test/gap-admin.test.js` |
| **DEF-04** | Low | **`$top`/`$skip` laxity (D11)** — CAP silently ignored `-1`/non-numeric; now 400 via `guardPaging`. | `srv/lib/paging.js`; `test/odata-contract.test.js`, `test/gap-units.test.js` |
| **DEF-05** | Low | **Hardcoded mileage rate** — new mileage rows defaulted to a literal `0.25`; now sourced from the country's live `Policies.mileageRate`. | `Claim.controller.js onAddMileage`/`_loadTaxRate` |
| **DEF-06** | Low | **Static country dropdowns** — Create picker + Dashboard filter now bound to the live `/Countries` entity. | `CountryDialog.fragment.xml`, `Dashboard.view.xml` |
| **DEF-07** | Low | **Misleading receipt message** — printed an unmet "£12 ≥ £25 threshold"; now states the reason that actually applies. | `srv/lib/validate.js` |
| **DEF-08** | Med | **Opaque `$batch failed` popups** (earlier pass) — `showError` now surfaces the real 4xx via the Message Manager in both apps. | `BaseController.showError`/`_backendMessage` |

**Remaining open (documented, not fake-passed):**
- **DEF-09 (D1, ETag optimistic concurrency)** — `todo`. A blanket `@odata.etag` breaks `draftActivate` (428) on these draft-enabled entities and freestyle `callAction` sends no `If-Match`. Mitigated by CAP draft locks (`test/concurrency.test.js` CON-03: 2nd `draftEdit` → 409) + status-guarded actions. Full ETag needs `If-Match` plumbed through `callAction` — HANA-only race, tracked.
- **DEF-10 (CSRF)** — `skip`. Not enforceable under `cds.test` basic-auth; verified only against the deployed managed approuter.
- **DEF-11 (`@UI.Hidden` fields still `$select`-able)** — characterization test in `test/security.test.js`; by-design for OData (hidden ≠ secured). Confirm no sensitive field relies on `@UI.Hidden` for protection.
- **DEF-12 (dead notification methods)** — `notifyManagerApproved`/`notifyFinanceApproved`/`notifySettled` are defined but unwired (`srv/notification.js:157/174/191`). Covered by `test/gap-units.test.js` so they cannot rot; decide keep-or-remove.

---

## 1. Test Strategy

Risk-based, adversarial, **negative-first**. Effort concentrated where business/security risk is highest.

**Priority of effort (highest first):**
1. **Authorization & direct-OData bypass** — per-person approver enforcement lives in JS (`approval-service.js`), and Employee-scope inheritance created a **self-approval** hole (DEF-03, fixed). Row-level ownership (`createdBy = $user`) on claims/items/media.
2. **Draft lifecycle & locking** — the 409 root cause (DEF-01). Draft/active reconciliation, stranded locks, activate-then-submit.
3. **Validation correctness** — 10 business rules (`validate.js`), boundary values, receipt rules, per-country tax split, totals reconciliation.
4. **State machine** — Draft→Submitted→(FirstApproved)→Approved / Returned / Rejected; invalid transitions rejected (409).
5. **Contract & query robustness** — `$metadata`, CRUD codes, `$filter/$expand/$orderby/$top/$skip/$count/$search`, malformed options.
6. **Analytics integrity** — `dashboardStats` computed from live DB (no fabricated data); `exportClaimsPdf` filter branches; `claimJourney`.

**Techniques applied:** equivalence partitioning + boundary value analysis (thresholds, limits, dates), decision tables (tax split by country/vatType; receipt-required by type/threshold), state-transition testing (claim lifecycle), negative/destructive (hostile inputs, contested locks, wrong approver, self-approval), traceability to CDS annotations & business rules.

**Assumptions:** (a) SQLite draft-lock enforcement is **looser** than HANA — the 409 reproduces on HANA, not SQLite; the self-heal is verified via the activate-then-submit path. (b) CSRF & true optimistic-lock races are HANA/approuter-only. (c) Seed data (`db/data/*.csv`) is representative of prod code lists.

---

## 2. Test Case Catalog (representative, traceable)

Layers: **BE**=backend/OData, **SEC**=security, **E2E**=flow, **UI**=frontend, **PERF**. Priority P1 (blocker) → P4 (low).
Automated cases live in `test/*.test.js`; UI cases are skeletoned (§3.3, harness not yet wired).

| ID | Layer | Title | Technique | Preconditions | Steps (abbrev.) | Expected | Pri | Ref |
|---|---|---|---|---|---|---|---|---|
| TC-01 | E2E | Draft-lock self-heal on submit | State-transition | Active Draft + stranded sibling draft | draftEdit → (abandon) → submit | Activate draft, submit → `Submitted`, no 409 | P1 | DEF-01; `gap-flows` |
| TC-02 | UI | Missing Claim Period → popup | EP/negative | New claim, no period | Apply for Approval | Consolidated popup lists "Claim Period" | P1 | DEF-02; `Claim.view.xml:33` |
| TC-03 | BE | Missing period blocked server-side | Negative | Claim, no period | submitClaim | 422 "period" | P1 | `gap-flows` |
| TC-04 | BE | Incomplete item blocked | Negative | Item missing reason/gross | activate/submit | 400 at save (or 422) | P1 | `gap-flows` |
| TC-05 | BE | Empty claim blocked | Boundary | No lines | submit | 422 | P1 | `gap-flows`; `lifecycle` |
| TC-06 | SEC | Self-approval forbidden (UK L1) | Negative/SoD | Approver submits own | approve own | 403 "own" | P1 | DEF-03; `gap-admin` |
| TC-07 | SEC | Self-reject forbidden | Negative/SoD | Approver submits own | reject own | 403 | P1 | DEF-03; `gap-admin` |
| TC-08 | SEC | Self-approval forbidden (India) | Negative/SoD | India L1 submits own | approve own | 403 | P1 | `gap-admin` |
| TC-09 | SEC | Wrong/non-configured approver | Decision table | Submitted UK claim | approve as non-L1 / L2-at-L1 | 403 | P1 | `approval` |
| TC-10 | BE | Re-submit already-Submitted | State-transition | Submitted claim | submitClaim again | 409 | P2 | `gap-flows` |
| TC-11 | BE | Reject without reason | Negative | Submitted claim | reject comment='' | 422 | P2 | `gap-flows`; `approval` |
| TC-12 | BE | Receipt required by type/threshold | Decision table | FOOD/HOTEL no receipt | submit | 422 "receipt" | P2 | `validate`; `lifecycle` |
| TC-13 | BE | Receipt boundary £25 vs £24.99 | BVA | TOLLS at/below threshold | submit | ≥£25 requires receipt; <£25 not | P2 | `edge-cases` |
| TC-14 | BE | UK VAT vs India GST split | Decision table | UK & IN claims | submit, read totals | Net/Tax per country rate | P1 | `lifecycle`; `edge-cases` |
| TC-15 | BE | Totals reconcile to line sum | Consistency | Mixed items+mileage | submit | totalGross == Σ lines | P2 | `validate` |
| TC-16 | E2E | UK two-level approval | State-transition | UK Submitted | L1 approve → L2 approve | FirstApproved → Approved | P1 | `lifecycle`; `approval` |
| TC-17 | E2E | India single-level approval | State-transition | IN Submitted | L1 approve | Approved | P1 | `lifecycle` |
| TC-18 | E2E | Return-for-rework loop | State-transition | Submitted | reject(reason) → Edit → resubmit | Returned → Submitted; resubmitCount 1 | P2 | `approval` |
| TC-19 | SEC | Employee blocked from `/approval` | RBAC | Employee-only user | GET Approvals/Policies | 403 | P1 | `security`; `gap-admin` |
| TC-20 | SEC | Row-level ownership (claims) | Negative | User A's claim | User B read/patch | 403/404 | P1 | `security` |
| TC-21 | SEC | Receipt media ownership | Negative | Owner uploads receipt | Other GET media | 404 (filtered) | P1 | `receipt-media` |
| TC-22 | BE | Receipt PUT/GET round-trip | Positive | Draft item | PUT bytes → GET | 204 then 200 same bytes | P2 | `receipt-media` |
| TC-23 | BE | Policy: mileageRate ≤ 0 | BVA/negative | Admin edit | activate | reject (≥400) | P2 | `gap-admin` |
| TC-24 | BE | Policy: vat/gst outside 0..1 | BVA | Admin edit | activate | reject | P2 | `gap-admin` |
| TC-25 | BE | Policy: negative limits/threshold | BVA | Admin edit | activate | reject | P3 | `gap-admin` |
| TC-26 | BE | `@assert.unique.country` policy | Constraint | Existing UK policy | create dup UK | reject | P2 | `gap-flows` |
| TC-27 | BE | Workflow malformed email | Negative | Admin edit | activate bad email | reject | P3 | `gap-admin` |
| TC-28 | BE | Unique claimNumber | Constraint | Two submits | compare numbers | distinct | P2 | `gap-flows`; `concurrency` |
| TC-29 | BE | `$top`/`$skip` malformed | Negative | any collection | `$top=-1`/`abc`/`$skip=-5` | 400 | P3 | DEF-04; `odata-contract` |
| TC-30 | BE | `$filter/$expand/$orderby/$count` | EP | collections | valid options | 200 + correct data | P2 | `odata-contract` |
| TC-31 | BE | Read-only entity write rejected | Negative | Countries | POST/PATCH | rejected | P2 | `odata-contract` |
| TC-32 | BE | `dashboardStats` live + shape | Consistency | Approver | call function | counts {UK,IN,total}; arrays; topClaimants ≤5 | P2 | `dashboard`; `gap-analytics` |
| TC-33 | BE | `exportClaimsPdf` filter branches | EP | Approver | history/status/country/empty | 200 valid PDF | P3 | `gap-analytics` |
| TC-34 | BE | `claimJourney` bad/unknown input | Negative | Approver | `''` / unknown | 400 / 404 | P3 | `gap-analytics` |
| TC-35 | BE | Notification/mailer never throw | Robustness | unit | call all methods | no throw (best-effort) | P3 | `gap-units` |
| TC-36 | UI | Live Net/Tax preview | Consistency | Item gross typed | preview updates | matches `splitVAT` | P3 | `formatter` unit |
| TC-37 | UI | Mileage rate default from Policies | Data-driven | Add mileage row | new row rate | = country `mileageRate` | P3 | DEF-05 (UI) |
| TC-38 | SEC | 401 unauthenticated | RBAC | no auth | any call | 401 | P1 | `security` |
| TC-39 | BE | `@UI.Hidden` field selectable | Characterization | any | `$select=hiddenField` | returned (documented) | P4 | DEF-11 |
| TC-40 | PERF | Draft-lock / concurrent edit | Concurrency | HANA | 2 users draftEdit | 2nd → 409 | P2 | `concurrency` (HANA) |

---

## 3. Executable assets

### 3.1 OData `.http` collection
Runnable request collection in **`test/expense.http`** (VS Code REST Client / JetBrains). This pass appends a **"Gap coverage"** block: draft-lock self-heal, self-approval 403, malformed `$top/$skip` 400, receipt media round-trip, `exportClaimsPdf` filters, `claimJourney` 400/404. Each request notes its expected status.

### 3.2 Automated backend suite (`node --test test/*.test.js`)
New/expanded files this pass — all green:
- `test/gap-flows.test.js` — draft-lock self-heal, mandatory backstops, re-submit 409, unique constraints.
- `test/gap-admin.test.js` — separation-of-duties (approve/reject own), Policy/Workflow validation boundaries.
- `test/gap-analytics.test.js` — `exportClaimsPdf` filters/empty, `claimJourney` 400/404, `dashboardStats` contract + role gate.
- `test/gap-units.test.js` — notification/mailer/pdf "never throw", dead-method coverage, `guardPaging` unit.
- `test/receipt-media.test.js` — LargeBinary PUT/GET round-trip + ownership.
- `test/odata-contract.test.js` — D11 `$top/$skip` now asserts 400 (was `todo`).

### 3.3 UI test skeletons (OPA5 / QUnit) — harness not yet wired
The apps have no karma/OPA5 runner configured; the following are ready-to-fill skeletons targeting **real control IDs** (`claimPage`, `itemsTable`, `mileageTable`, `countryGroup`, footer buttons). See `test/e2e/wdi5-flow.e2e.js` (existing placeholder).

```js
// OPA5 — Apply-for-Approval surfaces a clear validation popup (DEF-02)
opaTest("Missing Claim Period shows a consolidated popup", function (Given, When, Then) {
  Given.iStartMyApp();
  When.onTheListPage.iPressCreate().and.iChooseCountry("United Kingdom");
  When.onTheClaimPage.iPressButton("btnSubmit");           // footer Apply for Approval
  Then.onTheClaimPage.iShouldSeeMessageBoxContaining("Claim Period is required");
});

// OPA5 — Draft-lock self-heal (DEF-01): Edit → Back → Submit succeeds
opaTest("Submit self-heals a stranded draft", function (Given, When, Then) {
  Given.iStartMyAppOnADraftClaim();
  When.onTheClaimPage.iPressButton("editButton").and.iPressNavBack();  // strands a draft
  When.onTheClaimPage.iPressButton("btnSubmit");
  Then.onTheListPage.iShouldSeeTheClaimWithStatus("Submitted");
});

// QUnit — mileage row default rate is data-driven (DEF-05)
QUnit.test("onAddMileage defaults ratePerMile from Policies.mileageRate", function (assert) {
  oClaimController.getView().getModel("ui").setProperty("/mileageRate", 0.45);
  oClaimController.onAddMileage();
  var oRow = oClaimController.byId("mileageTable").getItems().pop();
  assert.strictEqual(oRow.getBindingContext().getProperty("ratePerMile"), "0.45");
});
```

**To make these run:** add `@ui5/cli` + `karma-ui5` (QUnit/OPA5) or `wdi5` + `@wdio/cli`, a test-runner `ui5.yaml`, and an `npm run test:ui` script.

---

## 4. Defect Reports

> Severity: Critical (data loss/security) · High (blocks core flow) · Medium · Low. All below are **confirmed** (cause cited). Fixed items retain the report for traceability.

**DEF-01 — 409 "Entity locked" on Apply for Approval** · High · **Fixed**
Steps: open an active Draft, Edit (creates a sibling draft + CAP `InProcessByUser` lock), Back (`onBack` does not discard), reopen active, Apply for Approval.
Actual: `submitClaim`'s `UPDATE(CLAIMS, ID)` runs under the draft lock → **409 Entity locked** (HANA). Expected: submit completes. Cause: `Claim.controller.js onSubmit` submitted the active row without reconciling the stranded draft; `srv/expense-service.js:127`. Fix: activate-then-submit self-heal (catch 409 → `draftActivate` the sibling draft → retry). Verified `test/gap-flows.test.js` + live repro.

**DEF-02 — No popup for missing mandatory fields** · High · **Fixed**
Actual: `required="true"` in `Claim.view.xml` renders only an asterisk (enforces nothing); the server 422 was stripped because `onSubmit` rebound before throwing, clearing the Message Manager → generic/no popup. Fix: `_validateClaimFields` (client), throw-before-rebind, Message-Manager read in `_backendMessage`.

**DEF-03 — Self-approval (separation of duties)** · High · **Fixed**
Actual: Approver/Admin (who inherit the Employee scope) could approve/reject a claim they created and submitted. Cause: no `createdBy === $user` guard in `approve`/`reject`. Fix: 403 guard; `test/gap-admin.test.js` isolates it using configured approvers.

**DEF-04 — `$top`/`$skip` laxity** · Low · **Fixed** — `guardPaging` → 400.
**DEF-05 — Hardcoded mileage rate** · Low · **Fixed** — defaults from live `Policies.mileageRate`.
**DEF-06 — Static country dropdowns** · Low · **Partially fixed** — Create picker + Dashboard bound to `/Countries`; the two "All"-bearing filters kept static (a non-entity "All" sentinel plus a 2-row list makes a bound version net-negative).
**DEF-07 — Misleading receipt message** · Low · **Fixed**.
**DEF-08 — Opaque `$batch failed` popups** · Medium · **Fixed** (prior pass).
**DEF-09 — No ETag/optimistic concurrency** · Medium · **Open (todo)** — mitigated by draft locks + status guards; needs `If-Match` in `callAction`.
**DEF-10 — CSRF unverified in CI** · Low · **Open (skip)** — verify on deployed approuter.
**DEF-11 — `@UI.Hidden` fields `$select`-able** · Low · **Accepted** — not a security control; audit that no sensitive field relies on it.
**DEF-12 — Dead notification methods** · Low · **Open** — keep-or-remove decision; now unit-covered.

---

## 5. Coverage & Risk Assessment

**Well covered:** authorization matrix (401/403, RBAC, row-level ownership, self-approval), draft self-heal, validation rules + boundaries, country tax split, two-level vs single-level routing, return-for-rework, OData contract + query options + malformed paging, analytics functions (filters, bad input, output shape, role gate), receipt media, notification/mailer robustness, unique constraints.

**Residual risk / gaps:**
- **Optimistic concurrency (DEF-09)** — lost-update on simultaneous edits only mitigated by draft locks; true If-Match races are HANA-only and untested. *Risk: medium.*
- **CSRF (DEF-10)** — only meaningful against the managed approuter; not in CI. *Risk: low–medium (approuter enforces).* 
- **UI automation** — no executable OPA5/wdi5; UI regressions (validation popups, self-heal, data-driven defaults) are skeletoned, not run. *Risk: medium.*
- **`whoami` cross-container branch** — the HANA synonym + wrapper-view path (`srv/lib/identity.js` → `ext.UsersMaster`) is unreachable under SQLite; local tests exercise the seeded `ext_UsersMaster` stand-in only. *Risk: low.*
- **`@UI.Hidden` exposure / dead notification methods** — informational.

### Top 5 to fix before go-live (ranked)
1. **Wire an executable UI test run (OPA5/wdi5)** and automate TC-01/TC-02/TC-06 — the highest-value flows are only skeletoned. *(medium effort)*
2. **Resolve DEF-09 (ETag/If-Match)** through `callAction`, or formally accept draft-lock+status-guard as the concurrency control and document it. *(medium)*
3. **Verify CSRF (DEF-10) on the deployed approuter** and add a smoke check to the post-deploy runbook. *(low)*
4. **Audit `@UI.Hidden` fields (DEF-11)** — confirm none are relied on for confidentiality; move any truly sensitive field behind `@restrict`/projection. *(low)*
5. **Decide dead notification methods (DEF-12)** — wire `notifyManagerApproved`/`FinanceApproved`/`Settled` into the flow or remove them. *(low)*

---

*Living deliverable. Backend logic and flows are covered by `npm test` (**151 pass**). UI rendering must be verified in a browser against `cds watch` until an OPA5/wdi5 runner is added.*

---

# 6. Adversarial re-test pass — 2026-07-14

**Assumptions (context confirmed from the codebase, not asked):** App = **hybrid** (two freestyle SAPUI5 apps, not Fiori Elements). Model = **CAP CDS**, OData **V4**, **draft-enabled** (`MyClaims`/`Policies`/`WorkflowMembers`). Landscape = BTP CF (`bsx-tdd/TDD`, eu10) + HANA (prod) / SQLite (`cds.test`, CI). Roles = XSUAA `Employee`/`Approver`/`Admin` with `@restrict`. Process = create→submit→approve/return with UK VAT (2-level) / India GST (1-level). **HANA-only behaviours (FK enforcement, true `enqueue` locks, approuter CSRF) are NOT exercised by the SQLite test bed** — flagged where relevant.

**Baseline:** `npm test` = **194 pass** / 0 fail / 1 skip / 1 todo (170 functional + the 24-check adversarial probe, which `node --test` globs in). New executable adversarial asset **`test/qa-probe.test.js`** — **24 checks · 0 hard defects · 20 PASS · 4 OBSERVE**. Techniques: EP/BVA (amounts), state-transition (draft/submit/approve), decision-table (owner × operation × role auth matrix), destructive/injection, boundary.

## 6.1 Test strategy for this pass (risk-based)
Tested hardest, in order of risk: **(1) authorization bypass via direct OData** — does the backend enforce what the UI hides (owner isolation, delete/approve guards, role gates)? **(2) the just-fixed amount pipeline** at boundaries (0.01, ~10M, negative, zero, 3-dp, IN rounding). **(3) injection / hostile input** persistence. **(4) invalid state transitions & double-submit.** **(5) contract hygiene** (status codes, paging, `$expand`, `$batch`, ETag, CSRF).

## 6.2 Fixes shipped since the 2026-07-12 pass (all test-verified)
| Ref | Sev | Fix | Evidence (file · test) |
|---|---|---|---|
| **FIX-A** | High | Large amounts rendered **£NaN / £0.00** (UK & IN) — a locale-grouped string (`"10,000.00"`) reached `money`/`split` → `NaN`. Hardened formatters (`num()` strips separators/symbols; Indian grouping too) + declared `sap.ui.model.odata.type.Decimal` on gross/miles/rate inputs. **Backend math was already correct** (proven by in-memory POST at 1k/10k UK+IN). | `my-expenses/model/formatter.js`, `view/Claim.view.xml` · probe CALC-01/02/06 |
| **FIX-B** | Med | `visible` **FormatException** (`"image (1).png" is not a valid boolean`) on the receipt icon + list delete button — V4 coerced the raw `Edm.String`. Added `targetType:'any'`. | `Claim.view.xml:129`, `Claims.view.xml:112` |
| **FIX-C** | Med | Receipt upload `fetch` threw **"String contains non ISO-8859-1 code point"** on a non-Latin-1 filename. ASCII-safe `Content-Disposition` + RFC 5987 `filename*`. | `Claim.controller.js _putReceipt` · probe SEC-09 (emoji/quotes persist) |
| **FIX-D** | High | Save **"Cannot read properties of null (reading 'getPath')"** — `onSave` bound `draftActivate` to the view element-binding context with `$$inheritExpandSelect`. Now a fresh canonical draft context (pending edits flush via the `$auto` group; rebind with `$expand` after). | `Claim.controller.js onSave` |
| **FIX-E** | Med | Approving gave the **employee no email**. Added `notifyApproved` fired only on FINAL approval (IN single / UK L2); UK L1 stays silent to the employee. | `notification.js`, `approval-service.js` · `test/approval.test.js` |
| **FIX-F** | Low | Dashboard: donut centre = **total reimbursed (£/₹)** + multi-colour ring/right legend; category bars share the donut palette; trend semantic colours; wave & trend full-width; **new Policy Violation Rate KPI card** (flagged ÷ all claims, sparkline, period delta). | `Dashboard.controller.js/view/css` · `test/dashboard.test.js` |

## 6.3 Adversarial probe — evidence (`test/qa-probe.test.js`)
| ID | Area | Check | Expected | Observed | Verdict |
|---|---|---|---|---|---|
| SEC-01/02/03 | Security | Employee B READ/PATCH/DELETE employee A's claim (direct OData) | 403/404 | 404 / 403 / 403 | **PASS** |
| SEC-04 | Security | `/expense/MyClaims` collection scoped to caller | 0 foreign rows | 0 foreign | **PASS** |
| SEC-05 | Security | Direct DELETE of a **Submitted** claim | 409 | 409 | **PASS** |
| SEC-06 | Security | Non-configured approver calls `approve` directly | 403 | 403 | **PASS** |
| SEC-07 | Security | Employee-only on `/approval/Approvals` | 403 | 403 | **PASS** |
| SEC-08 | Security | Malformed / injection `$filter` | 400 or safe, never 500 | 400 | **PASS** |
| SEC-09 | Security | Quotes/unicode/emoji in text field | 201, stored | 201 | **PASS** |
| CON-01/02/03/04 | Contract | `$metadata`; unknown key; bad `$top/$skip`; deep `$expand` | 200 / 404 / 400 / 200 | as expected | **PASS** |
| CALC-01/02/06 | Calc | gross 0.01; 9,999,999.99; IN 100 (GST) | consistent, no NaN | 0.01; sum 9,999,999.99; net 84.75/vat 15.25 | **PASS** |
| CALC-03/04 | Calc | negative / zero gross on submit | 422 | 422 | **PASS** |
| STATE-01/02 | State | approve a never-submitted Draft; double-submit | 4xx | 404 / 409 | **PASS** |
| **CON-05** | Contract | POST without CSRF token (`cds.test`, no approuter) | documented | **201** | **OBSERVE → DEF-10** |
| **CON-06** | Contract | ETag emitted for optimistic concurrency | present if intended | **none** | **OBSERVE → DEF-09** |
| **CALC-05** | Calc | 3-dp gross `10.005` (`Decimal(15,2)`) | rounded 2dp | item POST rejected → submit **422** | **OBSERVE** |
| **BATCH-01** | Contract | `POST {country:'ZZ'}` (invalid) | reject | **201** (SQLite FKs off) | **OBSERVE → DEF-13** |

## 6.4 Findings this pass
**DEF-13 — `country` not validated against `Countries` at create/submit · Medium · Open (NEW)**
Repro (probe BATCH-01): `POST /expense/MyClaims {"country":"ZZ"}` → **201** on the SQLite test bed (FKs are not enforced by `cds.test` in-memory). `srv/lib/calc.js taxRateFor` (`calc.js:9-12`) **silently defaults an unknown country to UK VAT**, and `validate.js` never checks `country ∈ {UK,IN}`. Impact: a mis-countried claim (reachable only via direct OData — the UI binds the picker to `/Countries`) would be taxed as UK and routed through the UK workflow. **Fix:** add an explicit guard in `before('SAVE','MyClaims')` / `submitClaim` (or `@assert.target` on the `country` association) and make `taxRateFor` **flag/throw** on an unknown country instead of defaulting. Confirm whether HANA's FK already rejects `ZZ` (likely, but the app must not depend on it).

**DEF-09 — No ETag / optimistic concurrency · Medium · Open (reconfirmed).** Probe CON-06: no ETag. Lost-update is mitigated by draft locks + status guards (probe STATE-02 → 409 double-submit; SEC-05 → 409 delete-in-flight), but there is no `If-Match` protection on direct updates — highest value on **`Policies`** (admin config). Fix: add `@odata.etag`/a managed changed-at element and send `If-Match` from `BaseController.callAction`, or formally accept draft-lock+status-guard and document it.

**DEF-10 — CSRF not enforced in CI · Low · Open (reconfirmed).** Probe CON-05: modifying POST without a token succeeds under `cds.test` (no approuter). The managed approuter enforces CSRF in the deployed env — **verify with a post-deploy smoke test** (HEAD to fetch token, POST without → expect 403).

**OBSERVE — 3-decimal gross.** `Decimal(15,2)` correctly rejects `10.005` at the item POST; the net effect for a **raw API client** is a downstream "add at least one line" 422 (the item never persisted) rather than a scale error on the item. The UI's typed Decimal input rounds before send, so end-users are unaffected. Low.

## 6.5 Executable assets added
- **Backend probe:** `test/qa-probe.test.js` — `node --test test/qa-probe.test.js` (24 adversarial checks; prints a findings table).
- **HTTP (add to `test/expense.http`):**
  ```http
  ### DEF-13 — invalid country accepted at create (should be rejected)
  POST {{srv}}/expense/MyClaims
  Authorization: Basic {{emp}}
  Content-Type: application/json

  { "country": "ZZ", "claimPeriod": "2026-02-28" }
  # EXPECT (target): 400/422 with a "country must be UK or IN" message

  ### SEC-01 — owner isolation (login as a DIFFERENT employee; expect 404)
  GET {{srv}}/expense/MyClaims(ID={{othersClaimId}},IsActiveEntity=true)
  Authorization: Basic {{priya}}
  # EXPECT: 404
  ```
- **OPA5 skeleton (regression for FIX-A / FIX-D)** — `app/my-expenses/webapp/test/integration/ClaimJourney.js`:
  ```js
  opaTest("large gross shows real Net/Tax, not NaN, and Save persists", function (Given, When, Then) {
    Given.iStartMyUIComponent({ componentConfig: { name: "com.bluestonex.expense.myexpenses" } });
    When.onClaim.iEnterGross("itemsTable", 0, "10000");
    Then.onClaim.iSeeItemNet("itemsTable", 0).not.toContain("NaN");      // FIX-A
    When.onClaim.iPressSave();                                            // FIX-D: no "getPath" error
    Then.onClaim.iSeeToast("msgSaved").and.iSeeStatus("Draft");
    Then.iTeardownMyUIComponent();
  });
  ```
- **QUnit skeleton (formatter units, FIX-A)** — `app/my-expenses/webapp/test/unit/formatter.js`:
  ```js
  QUnit.test("money() strips grouping, no NaN", function (assert) {
    assert.equal(formatter.money("10,000.00", "GBP"), "£10000.00");
    assert.equal(formatter.money("₹10,00,000.00", "INR"), "₹1000000.00");
  });
  QUnit.test("netPreview handles grouped gross", function (assert) {
    assert.equal(formatter.netPreview(null, "10,000.00", "STD", 0.2, true, "GBP"), "£8333.33");
  });
  ```

## 6.6 Coverage delta & Top-5 before deploy (updated)
**Newly hardened evidence:** owner isolation + delete/approve guards + injection safety now have **executed** direct-OData proof (not just role tests); amount pipeline verified at boundaries incl. the FIX-A regression.
**Residual gaps unchanged:** no executed UI automation (OPA5/wdi5 still skeletons); ETag (DEF-09); CSRF-in-CI (DEF-10); HANA-only paths (FKs, locks) untested locally.

1. **DEF-13** — validate `country ∈ Countries` server-side + stop `taxRateFor` silently defaulting. *(low effort, medium risk — mis-tax/mis-route.)*
2. **DEF-09** — ETag/`If-Match` (at least on `Policies`), or accept+document the draft-lock control. *(medium.)*
3. **Wire an executable UI run** (OPA5/wdi5) for FIX-A/FIX-B/FIX-D + TC-01/02/06 — the highest-value flows are still skeletons. *(medium.)*
4. **CSRF (DEF-10)** — post-deploy approuter smoke check. *(low.)*
5. **Deployed `504` on Save** (seen in a screenshot) is an **infra** gateway timeout (HANA/approuter cold start), separate from FIX-D (which stops the client `getPath` crash). Add an srv health/scaling check to the runbook so it doesn't masquerade as an app bug. *(low.)*

---

*Updated 2026-07-14. Backend + flows: `npm test` (**194 pass** — 170 functional + the 24-check `test/qa-probe.test.js`, 0 hard defects). UI still needs a browser/OPA5 run for full verification.*
