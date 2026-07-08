# QA Test Deliverable — BluestoneX Expense Reimbursement

**System under test:** SAP CAP (Node.js, OData V4) backend + two freestyle SAPUI5 apps
(`my-expenses`, `approval`). **Test bed:** local `cds.test` on in-memory SQLite + seed data
(HANA not deployed). **Date:** 2026-07-08. **Baseline:** 38 tests → **98 tests** (92 pass,
0 fail, 1 skip, 5 todo). Every finding cites `file:line`.

**Fixes applied this run (P1):** D10 + D9 — the two authorization bypasses are closed
(`MyClaimItems`/`MyMileageClaims` now own-rows-only; `ApprovalItems`/`ApprovalMileage` now
Approver/Admin-only). Their tests flipped from `todo` to green, plus an owner-path regression
guard. D3/D2/D1/D4/D6 remain reported and available to fix on request.

---

## 1. Test Strategy

Risk-based, adversarial, negative-first. Effort concentrated where business/security risk is
highest:

1. **Authorization & direct-OData bypass** — per-person approver enforcement lives only in JS
   (`approval-service.js:32,49,76-79`); several entity projections lack `@restrict`. Highest risk.
2. **Draft → submit → approve state machine** (UK 2-level vs India 1-level) — valid + invalid
   transitions, double-decision, submit-422-leaves-active-draft.
3. **Tax/money & validation** — decision tables over (country × vatType × rate), boundary values
   on the £25 receipt threshold and daily limits, the 9 implemented validation checks.
4. **Concurrency & identity** — no ETag anywhere; count-based `claimNumber`.

**Techniques:** equivalence partitioning + boundary-value analysis (calc + validation), decision
tables (tax, receipt, transitions), state-transition (draft/status), pairwise (country × vatType
× role), destructive/negative first. **Traceability:** each case maps to a CDS annotation, a
`validate.js` rule, or an `@restrict`.

**Assumptions:** money math is server-authoritative in `before('SAVE')` (UI is preview only);
"locking" = CAP draft locks (no ABAP enqueue); a true write-race is only reproducible on real
HANA (in-memory SQLite serialises).

---

## 2. Test Case Catalog

Priority: P1 critical · P2 high · P3 medium · P4 low. Layer: BE=backend, SEC=security,
E2E, UI, PERF. New tests are in `test/{odata-contract,security,edge-cases,concurrency}.test.js`;
UI in `app/*/webapp/test/`; manual REST in `test/expense.http`.

| ID | Layer | Title | Technique | Expected | Prio | Trace |
|----|-------|-------|-----------|----------|------|-------|
| BE-01 | BE | $metadata declares MyClaims + submitClaim | contract | 200, XML | P3 | odata-contract |
| BE-02 | BE | $filter eq/ne/and/or on code lists | equiv. partition | correct rows | P3 | odata-contract |
| BE-03 | BE | contains/startswith string filters | equiv. | ≥1 match | P4 | odata-contract |
| BE-04 | BE | $orderby desc ordering | ordering | sorted | P4 | odata-contract |
| BE-05 | BE | $select projects only chosen props | contract | subset | P4 | odata-contract |
| BE-06 | BE | $top + $count page vs total | boundary | len=2, count=total | P3 | odata-contract |
| BE-07 | BE | $skip past end | boundary | 200 empty | P4 | odata-contract |
| BE-08 | BE | $expand=items deep read | contract | nested items | P3 | odata-contract |
| BE-09 | BE | $search probe (support varies) | contract | 200/400/501 | P4 | odata-contract |
| BE-10 | BE | invalid $filter property | negative | 400 | P3 | odata-contract |
| BE-11 | BE | invalid $top (-1/abc) **(D11)** | negative | *400 desired*; 200 actual | P4 | odata-contract(todo) |
| BE-12 | BE | GET non-existent key | negative | 404 | P3 | odata-contract |
| BE-13 | BE | write to @readonly entity | negative | ≥400 | P3 | odata-contract |
| SEC-01 | SEC | unauthenticated request | negative | 401 | P2 | security |
| SEC-02 | SEC | employee-only → Admin entities | authz matrix | 403 | P2 | security |
| SEC-03 | SEC | employee-only → Approvals queue | authz matrix | 403 | P2 | security |
| SEC-04 | SEC | value-help sets readable by any auth user | authz | 200 (by design) | P4 | security |
| SEC-05 | SEC | employee-only invoking approve/reject | **bypass** | 403 | P1 | security |
| SEC-06 | SEC | PDF export role gate | authz | 403 emp / 200 appr | P3 | security |
| SEC-07 | SEC | cross-employee claim read by key | row-level | ≥400 | P1 | security |
| SEC-08 | SEC | cross-employee draftEdit | row-level | ≥400 | P1 | security |
| SEC-09 | SEC | @UI.Hidden field still selectable | info-exposure | present (info) | P3 | security |
| SEC-10 | SEC | **D10** MyClaimItems cross-employee leak | **bypass** | *403/empty desired*; **200+data actual** | **P1** | security(todo) |
| SEC-11 | SEC | **D9** ApprovalItems open to any auth user | **bypass** | *403 desired*; **200+data actual** | **P1/P2** | security(todo) |
| SEC-12 | SEC | CSRF missing/invalid token on POST | negative | 403 (deployed) | P3 | expense.http / skip |
| BL-01 | BE | UK 20% / IN 18% split decision table | decision table | exact net/vat | P2 | edge-cases |
| BL-02 | BE | ZR/EX zero-rated | decision table | vat 0 | P3 | edge-cases |
| BL-03 | BE | **D4** mistyped vatType silently zero-rated | decision table | *reject desired*; **accepted actual** | P2 | edge-cases(todo) |
| BL-04 | BE | **D5** negative gross in splitVAT | boundary | negative (char.) | P3 | edge-cases |
| BL-05 | BE | negative gross blocked at submit (safety net) | boundary | 422 | P2 | edge-cases |
| BL-06 | BE | net+vat reconciles to gross (rounding) | boundary | equal | P2 | edge-cases |
| BL-07 | BE | taxRateFor defaults + explicit-0 honoured | equiv. | correct | P3 | edge-cases |
| BL-08 | BE | claimTotals roll-up (mileage in net/gross) | equiv. | 125/20/145 | P2 | edge-cases |
| VAL-01 | BE | receipt threshold exact £25 (>=) | boundary | error | P2 | edge-cases |
| VAL-02 | BE | £24.99 below threshold | boundary | no error | P2 | edge-cases |
| VAL-03 | BE | periodEnd < claimPeriod (was untested) | boundary | error | P2 | edge-cases |
| VAL-04 | BE | meal spend exactly at limit (>) | boundary | allowed | P3 | edge-cases |
| VAL-05 | BE | meal spend £0.01 over limit | boundary | error | P3 | edge-cases |
| CON-01 | BE | **D1** mutable entity exposes ETag | concurrency | *ETag desired*; **absent actual** | P2 | concurrency(todo) |
| CON-02 | BE | **D2** concurrent activate unique claimNumber | concurrency | distinct (not repro in-proc) | P2 | concurrency(todo) |
| CON-03 | BE | draft-lock: 2nd draftEdit → 409 | state-transition | 409 | P3 | concurrency |
| APR-01 | BE | per-person approver identity (403 matrix) | decision table | 403/200 | P1 | approval(existing) |
| APR-02 | BE | reject requires reason | negative | 422 then ok | P2 | approval(existing) |
| APR-03 | BE | cannot approve twice | state-transition | ≥400 | P2 | approval(existing) |
| E2E-01 | E2E | submit→L1→L2 UK full flow + audit | scenario | Approved | P1 | lifecycle+wdi5 outline |
| E2E-02 | E2E | India single-level flow | scenario | Approved | P1 | lifecycle(existing) |
| UI-01 | UI | formatter money/net/vat preview | unit | correct/£NaN(D8) | P3 | formatterTests |
| UI-02 | UI | create-claim journey (OPA5) | journey | claim saved | P2 | CreateClaimJourney |
| UI-03 | UI | approve/reject journey + reason guard (D3) | journey | reject needs reason | P2 | ApproveRejectJourney |

---

## 3. Executable Assets (what was written)

**Runs under `npm test` (`node --test test/*.test.js`) — 97 tests green:**
- `test/odata-contract.test.js` — 15 contract/query-option cases.
- `test/security.test.js` — 13 authz/bypass cases (incl. the confirmed D9/D10 bypasses as `todo`).
- `test/edge-cases.test.js` — 25 boundary/decision-table cases (calc + validation).
- `test/concurrency.test.js` — D1/D2 (`todo`) + draft-lock (green).
- (existing: `approval.test.js` 19, `lifecycle.test.js` 9, `validate.test.js` 10.)

**Manual / live (not node):**
- `test/expense.http` — 21 ready-to-run OData requests (CSRF fetch → create → activate → submit
  → approve, query options, and the negative/bypass/CSRF cases) with expected status per request.
  Run against `cds watch`.

**UI (need an OPA5/Karma/wdi5 runner — authored-not-run, honestly labelled):**
- `app/my-expenses/webapp/test/unit/formatterTests.js` — QUnit unit tests (incl. D8 characterization).
- `app/my-expenses/webapp/test/integration/CreateClaimJourney.js` — OPA5 journey.
- `app/approval/webapp/test/integration/ApproveRejectJourney.js` — OPA5 journey.
- `test/e2e/wdi5-flow.e2e.js` — wdi5 end-to-end outline.
- `npm run test:ui` prints how to run these.

---

## 4. Defect Report

Confirmed = reproduced by a test or a direct `file:line` cause. Suspected = needs a live/HANA run.

### D10 — MyClaimItems bypasses per-employee row security  ·  **Critical (P1)**  ·  ✅ FIXED
- **Component:** `srv/expense-service.cds:33` (`entity MyClaimItems as projection on db.ITEMS;`).
- **Repro:** employee A creates a claim+item; employee B `GET /expense/MyClaimItems`.
- **Actual:** 200 — B sees A's line items (amounts, reasons). `MyClaims` is row-filtered by
  `employeeEmail = $user` (`:12`) but the sibling `MyClaimItems`/`MyMileageClaims` projections have
  **no `@restrict`**, so the filter is bypassed by reading the child set directly.
- **Expected:** B cannot see A's items (403 or empty).
- **Evidence:** `test/security.test.js` BYPASS-D10 (todo, reproduced).
- **Fix:** add `@restrict:[{grant:'*',to:'Employee',where:'claim.employee.email = $user'}]` to
  `MyClaimItems` and `MyMileageClaims`.

### D9 — ApprovalItems/ApprovalMileage readable by any authenticated user  ·  **High (P1/P2)**  ·  ✅ FIXED
- **Component:** `srv/approval-service.cds:45-46`.
- **Repro:** employee-only `priya` `GET /approval/ApprovalItems` → 200 with org-wide line items.
- **Actual:** any authenticated user (no Approver role needed) reads all claims' line items.
- **Expected:** Approver-only (like the parent `Approvals`).
- **Evidence:** `test/security.test.js` BYPASS-D9 (todo, reproduced).
- **Fix:** add `@restrict:[{grant:'READ',to:'Approver'}]` (and Admin if history needs it) to both.

### D3 — Approve/Reject double-submit  ·  **High (P2)**  ·  CONFIRMED (code)
- **Component:** `app/approval/webapp/controller/Approvals.controller.js:135` vs
  `ReviewDialog.fragment.xml:72-73`.
- **Cause:** `_decide` calls `this.getView().setBusy(true)`, but Approve/Reject live in the
  `reviewDialog` popup (static area), which the view busy-overlay does not cover → a fast
  double-click fires `ApprovalService.approve` twice.
- **Impact:** duplicate decision / spurious 422 on the second call; risk of double state transition.
- **Fix:** disable the pressed button (or `oDialog.setBusy(true)`) for the in-flight action.

### D2 — claimNumber is count-based with no uniqueness guard  ·  **High (P2)**  ·  CONFIRMED (code)
- **Component:** `srv/expense-service.js:49-53`; `db/schema.cds:75` (no unique).
- **Cause:** `EXP-{year}-{rows.length+1}` from a full-table COUNT in `before('SAVE')`, no lock, no
  DB unique constraint. Concurrent activations can mint the same number; a delete makes the counter
  reuse an existing number.
- **Repro:** not reproduced in-process (SQLite serialises — `CON-02` passed); confirmed by code and
  reproducible under concurrent HANA.
- **Fix:** derive from `MAX(suffix)+1` inside the transaction (or a DB sequence) **and** add a
  unique constraint on `claimNumber`.

### D1 — No optimistic concurrency (no ETag)  ·  **Medium/High (P2)**  ·  CONFIRMED
- **Component:** entire model — zero `@odata.etag`/`@cds.on.update` in `db/`+`srv/`.
- **Impact:** two approvers, or submit+approve, racing the same claim → lost update / double
  transition; no `If-Match`/412 protection. `CON-01` shows no ETag header is returned.
- **Fix:** annotate mutable entities `@odata.etag` on managed `modifiedAt` (validate draft behaviour).

### D4 — Unknown/mistyped vatType silently zero-rated  ·  **Medium (P2/P3)**  ·  CONFIRMED
- **Component:** `srv/lib/calc.js:19`; no `vatType` validation in `validate.js`.
- **Cause:** only exact `'STD'` applies tax; `'std'`, `'Std'`, or any bad code → 0 tax, no error.
  `VAT_TYPES.rate` (seeded) is never read.
- **Repro:** `edge-cases` BL-03 (todo) — item with `vatType:'std'` submits (200) at full net.
- **Fix:** validate `vatType ∈ VAT_TYPES` in `before('SAVE')`/`validate.js`; or drive the rate from
  `VAT_TYPES.rate`.

### D6 — INR claims render `£` in audit + ANS bodies  ·  **Medium (P3)**  ·  CONFIRMED
- **Component:** `srv/expense-service.js:102`; `srv/notification.js:104,136,…`.
- **Cause:** hardcoded `£` in the audit "Total £…" and several ANS/event strings, despite a
  currency-aware `money()` helper existing (`notification.js:9`).
- **Repro:** `edge-cases` D6 (todo) — IN claim's Submitted audit entry contains `£`, not `₹`.
- **Fix:** use `money(claim)` for all money strings in audit + notifications.

### D5 — Negative gross/miles accepted on a draft  ·  **Low (P3)**  ·  CONFIRMED
- **Component:** `srv/lib/calc.js:17-28`. Negative values persist on a draft and drive negative
  header totals. **Mitigated:** submit is blocked by validation rule 1 (`BL-05` passes, 422).
- **Fix (optional):** guard `< 0` in `splitVAT`/`mileageTotal`, or validate at draft time.

### D7 — CSRF token cached, never refreshed  ·  **Medium (P3)**  ·  SUSPECTED
- **Component:** `app/my-expenses/webapp/controller/Claim.controller.js:117-122`. On token
  rotation/expiry, subsequent receipt PUTs get 403 with no re-fetch/retry.
- **Fix:** on a 403, re-fetch the token once and retry the PUT.

### D8 — money formatter emits `£NaN` for non-numeric input  ·  **Low (P3)**  ·  CONFIRMED
- **Component:** `formatter.js:9` (my-exp), `:47` (approval). `Number('abc')→NaN→'NaN'`.
- **Fix:** `Number.isFinite(n) ? n.toFixed(2) : '0.00'`.

### D11 — invalid `$top` not rejected  ·  **Low (P4)**  ·  CONFIRMED
- `$top=-1` returns 200 (silently ignored) instead of 400. Framework-level laxity; document/accept.

### S1 — reject vs approve differ when workflow missing  ·  **Low (P4)**  ·  SUSPECTED
- `approval-service.js:74-79` (reject → 403) vs `:26` (approve → 422) for the same missing-workflow
  precondition. Align to one code/message.

### S2 — exportClaimsPdf ignores a single-sided date filter  ·  **Low (P4)**  ·  SUSPECTED
- `approval-service.js:142-143` — `if (fromDate && toDate)`; one-sided range applies no filter.

### S3 — inline row create() promise unhandled  ·  **Medium (P3)**  ·  SUSPECTED
- `Claim.controller.js:94-96,107-109` — `onAddItem/onAddMileage` don't handle the created promise;
  a server-side rejection is silent (no user feedback). Add `.created().catch(showError)`.

---

## 5. Coverage & Risk Assessment

**Well covered now:** tax split + totals (decision table + boundaries), the 9 validation checks
incl. previously-untested `periodEnd<claimPeriod` and exact-threshold boundaries, the full
draft→submit→approve state machine (UK/India), per-person approver identity, RBAC on Admin/Approver
entities, OData query-option surface, and — newly — **direct-OData authorization bypass**.

**Residual risk / gaps:**
- **Concurrency** can't be truly exercised in-memory; D1/D2 need a HANA hybrid run to reproduce.
- **UI journeys are authored-not-run** — no OPA5/Karma/wdi5 runner is configured; the UI has
  significant **missing-id testability gaps** (most action buttons; the entire `Policy.view`).
- **Non-functional:** accessibility (empty column headers, index-based country choice), i18n
  (many hardcoded strings), locale money/date formatting, theming, responsiveness, and performance
  (growing tables, `_loadCounts` 999-cap) are reviewed but not automated.
- **Media upload** (`receipt` stream/CSRF) is not covered by an automated test.

### Top 5 to fix before go-live (ranked)
1. ~~**D10** — add `@restrict` to `MyClaimItems`/`MyMileageClaims`~~ ✅ **FIXED this run**.
2. ~~**D9** — add `@restrict` to `ApprovalItems`/`ApprovalMileage`~~ ✅ **FIXED this run**.
3. **D3** — guard Approve/Reject against double-submit. *(open)*
4. **D2** — make `claimNumber` collision-proof (max+1 in txn + unique constraint). *(open)*
5. **D1** — add optimistic concurrency (`@odata.etag`) on mutable entities. *(open)*
