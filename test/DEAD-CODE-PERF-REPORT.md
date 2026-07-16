# Dead-Code & Performance Report — Phase 5

> **Status: findings only. No code was changed by this phase.**
> Per the coverage-plan ground rule, removals/optimizations are deferred to their own
> follow-up PR so the Phase 1–3 tests exist first to prove those changes safe.
> Generated 2026-07-15 on branch `feat/freestyle-two-apps`.

## Method
- **Backend dead code:** Node built-in coverage (`npm run test:coverage`, `--test-coverage-include='srv/**'`) for unreached lines, cross-checked with a graphify-oriented reference sweep of every `srv/lib` export and CDS entity/field/CSV column.
- **UI dead code:** graphify call-graph for controller/formatter references, plus bare-name greps across each full `webapp/` for XML-string-wired handlers, `.formatter.x` refs, i18n keys and CSS selectors (graphify doesn't index XML strings / properties / CSS). Manifest `{{...}}` placeholders and dynamic class concatenation (`"bsxTlDot--" + tone`) were excluded to avoid false positives.
- **Performance:** compile + build timing, coverage as a proxy for reachable surface, and the existing guard tests.

---

## Part A — Dead code

### A0. Backend `srv` has zero dead *lines*
Every uncovered line in the coverage report is **reachable-but-untested**, not dead:

| File | Uncovered | Classification |
|---|---|---|
| `approval-service.js` | 189-193 | WorkflowMembers `after('SAVE')` audit — reachable via Admin edit |
| `approval-service.js` | 254-257 | ClaimHistory attachments map — reachable when a claim has receipts |
| `approval-service.js` | 279-280 | `exportClaimsPdf` date-range filter — reachable with from+to |
| `mailer.js` | 69-71 | `nodemailer` not-installed catch — nodemailer *is* installed |
| `notification.js` | 70-126 | ANS HTTP emission — unreachable without a bound alert-notification service (by design; ANS free-plan capped) |

→ No `srv` line is dead. The coverage gap is exercise, not cruft.

### A1. Dead exported symbols (backend)

| Symbol | Location | Confidence | Nature | Recommendation |
|---|---|---|---|---|
| whole module `employee-source.js` (`findByEmail`, `useUsersMaster`) | (removed) | n/a | **Deleted** in the USERS_MASTER cut-over — `ext.UsersMaster` is now the single employee source, so the dual-source flag/module is gone. | **Done — deleted.** |
| `notifyManagerApproved` | `srv/notification.js:218` | CONFIRMED 0 callers | **Accidental** — legacy approval-step notifier; the current UK/India flow no longer calls it. | Remove in the follow-up PR. |
| `notifyFinanceApproved` | `srv/notification.js:235` | CONFIRMED 0 callers | Accidental (as above). | Remove. |
| `notifySettled` | `srv/notification.js:252` | CONFIRMED 0 callers | Accidental — there is no "Settled" step in the current model. | Remove. |

All other lib exports are live (`calc.*`, `validate.validateClaim`, `audit.record`, `mailer.sendMail`, `paging.guardPaging`, `pdf.renderClaimsPdf`, `identity.*`, `load-claim.*`, and the four *used* notification methods). **No dead file-local helpers.**

### A2. Likely-dead CDS fields & CSV columns

| Field / column | Location | Confidence | Note |
|---|---|---|---|
| `EMPLOYEES.{UserID,OrgID,Mobile,ManagerID,Pic,PicB,TargetUtilization,TargetHrsPerWeek,BonusPercent,PensionRate}` | `db/schema.cds:42-58` | LIKELY | **Intentional** — deliberate 1:1 mirror of USERS_MASTER for CSV import parity (schema comment L32-39). Keep. |
| `POLICY.effectiveFrom` / `POLICY.effectiveTo` | `db/schema.cds:78-79` | LIKELY | Unimplemented policy-versioning; `effectiveTo` isn't even seeded. Candidate to remove *or* wire up. |
| `ITEMS.notes` | `db/schema.cds:147` | LIKELY | Has a `@title` but is never bound in any Claim view nor read by a handler. |
| `TAX_TYPES.rate` | `db/schema.cds:21` | LIKELY (prod) | Not read by any `srv` handler (tax rate comes from `POLICY.vatRate/gstRate` via `calc.taxRateFor`). **But it IS read by tests** (`test/lib/config.js readTaxRate`, `country-config.test.js`), so not fully orphaned — decide whether the config table should own the rate. |
| `EXP-POLICY.csv → effectiveFrom` | `db/data/` | mirrors dead field | — |
| `EXP-TAX_TYPES.csv → rate` | `db/data/` | mirrors above | — |

**No CONFIRMED dead entity** — all 10 entities have a projection + code reference.

### A3. Dead UI code — `my-expenses`

| Kind | Item | Location | Confidence |
|---|---|---|---|
| Controller method | `toast` | `controller/BaseController.js:83` | CONFIRMED (no `.toast(` call anywhere) |
| Formatter | `receiptText` | `model/formatter.js:105` | CONFIRMED |
| Formatter | `isDraft` | `model/formatter.js:110` | CONFIRMED |
| Formatter | `canEditDraft` | `model/formatter.js:115` | CONFIRMED |
| i18n keys (15) | `btnGo, filterPeriod, btnCancel, detailTitle, sectionApproval, lblClaimNo, lblDept, lblPayroll, lblCurrency, lblStatus, lblGross, btnView, notAttached, statusReturned, msgAddItemFirst` | `i18n/i18n.properties` | CONFIRMED |
| CSS | `.bsxChainNode`, `.bsxChainConnector`, `.bsxChainCard` | `css/style.css:79-86` | CONFIRMED (approval-chain leftovers; that HTML lives only in the approval app) |
| CSS | `.bsxBody` | `css/style.css:23` | LIKELY (never applied; harmless — sits in a grouped `html,body,...` rule) |

### A4. Dead UI code — `approval`

| Kind | Item | Location | Confidence |
|---|---|---|---|
| Controller method | `onResetLayout` | `controller/Dashboard.controller.js:527` | CONFIRMED (also corroborated by unused key `dashResetLayout`) |
| Controller method | `toast` | `controller/BaseController.js:63` | CONFIRMED |
| Formatters | — none — | | |
| i18n keys (38) | incl. `brand, navApproval, statusReturned, apvChooseHint, apvUKSub, apvINSub, btnOpen, btnGo, filterPeriod, searchClaim, kpiRejected, noReceipt, policyChooseHint, countryUKName, countryUKSub, countryINName, countryINSub, tagVat, tagGst, btnConfigure, btnBack, workflowTitle, wfUKSub, wfINSub, btnManage, colWfCountry, colFirst, colSecond, wfHint, dashFrom, dashCurrency, dashAmount, dashGeo, dashGeoClaims, dashGeoApproved, dashTrendHint, dashResetLayout, dashDragHint` | `i18n/i18n.properties` | CONFIRMED |
| CSS (12) | `.bsxDanger, .bsxChainCard, .bsxChoiceCard, .bsxCardTag, .bsxCardPill, .bsxKpiSub, .bsxVVal, .bsxDonutArc, .bsxDonutIcon, .bsxHFill--blue, .bsxHFill--violet, .bsxHFill--muted` | `css/style.css` | CONFIRMED |
| CSS | `.bsxBody` | `css/style.css:41` | LIKELY |

> **Not dead (verified, excluded):** `onTabEnter` (invoked dynamically via `App.controller.js:54` `typeof oCtrl.onTabEnter === "function"`), `onAfterRendering` (lifecycle), `bsxTlDot--ok/--no/--sub` (built as `"bsxTlDot--"+tone`), `appTitle/appDescription/tileSubtitle` (manifest `{{...}}`), and ~40 `sap*` framework-override selectors.

**Cross-app note:** `.bsxChainCard` and the chain classes are dead in *both* apps — remnants of the approval-journey chain diagram that was replaced. `.bsxHFill--*` modifiers are dead because the Dashboard now emits `.bsxHFill` with an inline `background:` instead of modifier classes. `statusReturned` and `.bsxBody` are dead in both.

---

## Part B — Performance & optimization gauges

| Gauge | Result | Verdict |
|---|---|---|
| `npx cds compile srv db -s all --to edmx-v4` | warning-free, **0.55 s** | ✅ |
| `build:cf` — my-expenses | Build succeeded, **~0.23 s** (0.76 s wall) | ✅ |
| `build:cf` — approval | Build succeeded, **~0.20 s** (0.71 s wall) | ✅ |
| `srv` line coverage | **96.06%** line / 77.98% branch / 92.64% func | ✅ line; branch dragged only by the unreachable ANS path |
| Paging guard (`$top`/`$skip` → 400) | covered (`gap-units`, `odata-contract`, `qa-probe`) | ✅ |
| N+1 avoidance | ClaimHistory enrichment is 2 batch SELECTs, not per-row (documented `approval-service.js:196-198`) | ✅ |
| Debug leftovers (`console.log`/`debugger`) in srv+app | **0** | ✅ |
| `TODO/FIXME/XXX/HACK` markers in srv+app | **0** | ✅ |
| Test suite | 216 pass / 0 fail / 1 skip (CSRF) / 1 todo (ETag) | ✅ |
| Mail during tests | `MAIL_DISABLED=true` in `test`+`test:coverage` scripts → 0 sends | ✅ |

No hot-path or query-count concerns surfaced. `dashboardStats` does a single `SELECT` with expand and aggregates in memory — fine at expected claim volumes; if the CLAIMS table grows large, push the date/country filter and status counts into the DB query (not needed now).

---

## Part C — Proposed follow-up PR (separate from coverage work)

Ordered by safety/value; each is independently revertible:

1. **Remove 3 dead notification methods** (`notifyManagerApproved`, `notifyFinanceApproved`, `notifySettled`) — zero callers, pure deletion. *(Lowest risk.)*
2. **Prune dead UI cruft** — the 3 my-expenses formatters + `toast` in both BaseControllers + `onResetLayout`; the ~53 unused i18n keys; the confirmed orphaned CSS classes. Re-run `build:cf` + a UI smoke after.
3. **Decide `POLICY.effectiveFrom/To` and `ITEMS.notes`** — either wire them up (policy versioning / item notes UI) or drop the fields + CSV columns. Needs a product call.
4. **Decide `TAX_TYPES.rate` ownership** — should the config table drive the tax rate (and `calc.taxRateFor` read it), or is `POLICY.vatRate/gstRate` the single source? Today it's neither-fully — the field exists and tests read it, but production ignores it.
5. **Done** — `employee-source.js` and the local `EMPLOYEES` mirror were removed in the USERS_MASTER cut-over; `ext.UsersMaster` (the live org table) is the single employee source.

> Do **not** remove any item in category 3/4 without owner sign-off — those touch the data model and the config-driven contract.
