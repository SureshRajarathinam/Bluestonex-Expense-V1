# BluestoneX Expense Reimbursement System

A modern, end-to-end **Expense Reimbursement System** built on **SAP Cloud Application Programming Model (CAP)** with **SAP Fiori** front-ends, designed to run on **SAP BTP**.

> **Stack:** SAP CAP (Node.js) · OData V4 · **freestyle SAPUI5** (XML views + JS controllers, `sap.tnt` shell) · SQLite (dev) / SAP HANA Cloud (prod) · XSUAA · BTP Alert Notification Service · SMTP mailer (nodemailer) for approver emails
> **Status:** **UK & India** support · **2 freestyle SAPUI5 apps** (My Expenses, Approval) · 2 OData services · **113 automated tests passing** (`npm test`)

---

## 1. Background & the problem

In many organisations, managing employee business expenses (travel, meals, mileage) is manual, fragmented, or reliant on spreadsheets. The original BluestoneX process used an **Excel "Employee Expense Claim Form"** emailed around for signatures. This caused:

- **Administrative overhead** — manual form filling, receipt tracking, re-keying by finance.
- **Slow reimbursements** — email-based approval bottlenecks.
- **No transparency** — employees couldn't see claim status; management lacked spend insight.
- **Weak policy compliance** — daily limits, mileage rates and receipt rules enforced inconsistently.
- **Data silos** — no auditable history or analysis.

This project replaces that with a digital, policy-enforced, fully auditable workflow modelled directly on the original Excel form (employee/site/payroll header, dated line items with VAT split, mileage at a per-mile rate, multi-stage sign-off).

---

## 2. Solution overview

A simplified **two-area** landscape supporting **UK and India** employees, backed by **two** CAP OData V4 services:

- **My Expenses** (`/expense`) — employees pick **UK or India** on Create, enter **multiple items inline** on one page with **per-item attachments** and a **live Net/Tax preview** next to each Gross, and *Apply* (submit). Tax is **VAT (UK)** or **GST (India)** from config. The header greets the signed-in employee by name (`whoami`).
- **Approval area** (`/approval`) — one freestyle SAPUI5 app with a **`sap.tnt.ToolPage` side navigation** exposing **five sections** on one service:
  - **Dashboard** (Approver/Admin) — analytics: KPI tiles, spend-by-category bars, "Total reimbursed spend" donut, Top-5 claimants, submitted/approved/returned trend, spend-by-country map, filtered by date range + UK/India.
  - **Approvals** (Approver) — approve/reject pending claims.
  - **Policy Configuration** (Admin) — VAT/GST rates, mileage rate, limits, receipt threshold.
  - **Approval Workflow Members** (Admin) — the approvers per country.
  - **History** (Approver/Admin) — every non-draft claim with journey detail + server-side PDF export.

Approval routing is **country-driven**: **UK = two-level** (L1 → L2), **India = single-level** (L1). Each approval hop **emails the configured approver** (submit → L1; UK L1-approve → L2). Policy is enforced centrally (10 business rules), receipts are mandatory above a configurable threshold, and every state change is written to an audit log.

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        SAP BTP Launchpad (FLP)                         │
│                                                                        │
│   My Expenses (freestyle)          Approval (freestyle, ToolPage)      │
│   Employee                         Dashboard · Approvals · Policy ·    │
│                                    Workflow · History (Approver+Admin) │
└─────┬───────────────────────────────────────┬─────────────────────────┘
      │ /expense                    │ /approval
┌─────▼─────────────────┐  ┌────────▼───────────────────────────────────┐
│   ExpenseService      │  │           ApprovalService                   │
│   draft · submit      │  │  Approvals (approve/reject, country routing) │
│   country-aware tax   │  │  Policies · WorkflowMembers · ClaimHistory · │
│   whoami greeting     │  │  dashboardStats · claimJourney · AuditLogs   │
└───────────┬───────────┘  └───────────────────┬─────────────────────────┘
            └─── shared libs: calc · validate · load-claim · audit · mailer ───┘
              notification → BTP Alert Notification Service + SMTP mailer (approvers)
                                  │ CDS model (db/schema.cds)
                    ┌─────────────▼──────────────┐
                    │  SQLite (dev) / HANA (prod) │
                    └─────────────────────────────┘
```

---

## 4. The apps

| App | Path | Type | Role | Purpose |
|---|---|---|---|---|
| **My Expenses** | `/my-expenses` → `/expense` | Freestyle SAPUI5 (list + single-page detail, draft) | Employee | Pick country on Create, add **inline** items + mileage + attachments on one screen, **Apply for Approval** |
| **Approval** | `/approval` → `/approval` | Freestyle SAPUI5 (`sap.tnt.ToolPage` side nav, 5 sections) | Approver + Admin | Sections: **Dashboard** (analytics), **Approvals** (approve/reject), **Policy Configuration** (VAT/GST/limits), **Approval Workflow Members** (L1/L2 approvers per country), **History** (all non-draft claims + PDF export) |

> The former four Fiori Elements apps are consolidated into **two freestyle SAPUI5 apps**. The Approval app merges Dashboard, Approvals, Policy Configuration, Workflow Members and History into one app whose `sap.tnt.ToolPage` side navigation switches between five embedded views over the single `/approval` service.

---

## 5. Claim lifecycle (country-driven)

```
  UK (two-level):
   Draft ─Apply▶ Submitted ─L1 approve▶ FirstApproved ─L2 approve▶ Approved
                     │ reject(reason)        │ reject(reason)
                     └──────────▶ Rejected ◀─┘

  India (single-level):
   Draft ─Apply▶ Submitted ─L1 approve▶ Approved
                     └ reject(reason) ▶ Rejected
```

- The **approver at each level is configured per country** in *Approval Workflow Members* (UK: first + second; India: first only). The `approve`/`reject` actions verify the caller is that configured person (403 otherwise).
- **Visibility:** Approvers see only claims **pending** a decision (`Submitted` / `FirstApproved`); drafts and completed claims are hidden.
- A rejection **requires a reason**. Status drives Fiori colour coding via a computed `statusCriticality`. There is no separate "settle" step — final approval completes the claim.

---

## 6. Data model (`db/schema.cds`)

| Entity | Notes |
|---|---|
| `ExpenseClaims` | Header: claimNumber, employee, **country (UK/IN)**, claimPeriod, status, totals (net/tax/gross), generic approval trail (`level1*`, `level2*`, `rejected*`). Compositions to items & mileage. |
| `ExpenseItems` | Dated line items: type, destination, reason, tax type, gross → **net/tax split**, receipt media. |
| `MileageClaims` | Trip date, destination, reason, engine type, miles × rate = total. |
| `Employees` | Master data: number, name, email, site, dept, payroll area, **role**, active flag. |
| `ExpensePolicy` | mileageRate (£0.25), hotelDailyLimit (£200), mealDailyLimit (£40), **receiptThreshold (£25)**, **vatRate (20%)**, **gstRate (18%)**. |
| `ApprovalWorkflow` | Per country: `firstApprover`, `secondApprover` (UK has both; India only first). |
| `AuditLog` | Append-only trail: timestamp, user, action, object type/key, details. |
| Code lists | `Countries` (UK/IN), `ExpenseTypes`, `VATTypes`. (No `Roles` table — roles are governed entirely by BTP XSUAA role collections.) |

**Computation:** the per-item tax split (VAT for UK, GST for India), mileage totals, and claim roll-ups are computed in a **`before('SAVE')`** handler using `srv/lib/calc.js` — `taxRateFor(country, policy)` picks the rate. (Tax columns keep the names `vatType/vatAmount/totalVAT` but hold the country tax; UI labels say "Tax".)

---

## 7. Business rules (all 10)

Enforced via the pure module **`srv/lib/validate.js`**, called from `submitClaim` (rule 8 — blocks submission) and `financeApprove` (rule 10 — re-verifies before sign-off).

| # | Rule | Enforcement |
|---|---|---|
| 1 | Required fields cannot be blank | per-field `@mandatory` + `validate.js` |
| 2 | Expense date cannot be in the future | `validate.js` |
| 3 | Claim total must equal sum of line items | `validate.js` (totals computed on SAVE) |
| 4 | Receipt mandatory at/above threshold (£25, configurable) | `validate.js` + actual uploaded content check |
| 5 | Meal / hotel daily limits + mileage rate cap | `validate.js` against `ExpensePolicy` |
| 6 | Mileage requires distance **and** rate | `validate.js` |
| 7 | Duplicate-looking items trigger a **warning** (non-blocking) | `validate.js` → `req.warn` |
| 8 | Submission blocked if any critical violation exists | `submitClaim` → 422 with list |
| 9 | Rejected claims require a rejection reason | `reject` action → 422 |
| 10 | Approval requires verified totals & policy compliance | re-runs `validate.js` |

---

## 8. Receipt photo upload

- **Per expense item**, using SAP CAP media handling (`receipt : LargeBinary` with `@Core.MediaType`, `@Core.ContentDisposition`).
- Employees attach a photo/PDF **inline** in the items table on the claim page (no separate item page).
- **Mandatory** when an item's gross is at/above the policy `receiptThreshold` (or the expense type requires it) — submission is blocked until attached.
- Approvers get a **View Receipt** download link on each item.

---

## 9. Roles & security

Defined in **`xs-security.json`** (XSUAA) — scopes, role templates, and role collections:

| Role collection | Scope | Can |
|---|---|---|
| `Expense_Employee` | `Employee` | Own claims (`employeeEmail = $user`) |
| `Expense_Approver` | `Approver` (+Employee) | Approve/reject claims they are configured for |
| `Expense_Admin` | `Admin` | Policy configuration & approval workflow members |

- *Who* approves at L1/L2 (UK) or the single level (India) is driven by **Approval Workflow Members** (per person/email), not by role — the `approve`/`reject` actions verify the caller is the configured approver.
- Services use service-level `@requires` (metadata readable so apps render) with entity/action `@restrict` for data access.
- **Every workflow transition and config change is written to the audit log** (`srv/lib/audit.js`, additive).
- **Dev note:** local mocked auth (`.cdsrc.json`) grants the demo users all roles for convenience; production keeps roles separate via XSUAA. `clerk` / `priya` (Employee-only) back the RBAC tests.

---

## 10. The Approval app (5 sections on `/approval`)

One freestyle SAPUI5 app with a `sap.tnt.ToolPage` shell whose **side navigation** switches an inner `NavContainer` between five embedded views (each section resets to a clean state on re-entry):

| Section | What it does |
|---|---|
| **Dashboard** | Read-only analytics over `CLAIMS` (`dashboardStats`): KPI tiles (awaiting/approved/returned), spend-by-category bars, "Total reimbursed spend" donut, Top-5 claimants, submitted/approved/returned trend, and a spend-by-country map — filtered by date range and UK/India. |
| **Approvals** | List of claims pending the user's decision → **Review** dialog (items, mileage, receipt links) → **Approve / Reject** (Reject requires a reason). UK needs L1 then L2; India needs L1 only. |
| **Policy Configuration** | **Edit** the policy → change VAT/GST rate, mileage rate, limits, receipt threshold → **Save** (draft flow). Feeds the rules + tax engine. |
| **Approval Workflow Members** | Per country, edit the **first-level** and **second-level** (UK only) approver emails. |
| **History** | Every non-draft claim (org-wide) with a free-text search + status/country/period filters, a per-claim **journey** timeline (`claimJourney`), and **server-side PDF export**. |

---

## 11. Project structure

```
.
├── db/
│   ├── schema.cds                  # Entities, code lists, ApprovalWorkflow, labels, media
│   └── data/*.csv                  # Seed (employees, policy, countries, workflow, types)
├── srv/
│   ├── expense-service.{cds,js}    # Employee service (/expense) — draft, country tax, submit
│   ├── approval-service.{cds,js}   # Merged service  (/approval) — approve/reject, policy, workflow, audit
│   ├── notification.js             # ANS events + approver email dispatch (via mailer)
│   └── lib/
│       ├── calc.js                 # taxRateFor, VAT/GST split, mileage, totals (pure)
│       ├── validate.js             # All 10 business rules (pure)
│       ├── load-claim.js           # Validation context loader
│       ├── audit.js                # Audit-log writer
│       ├── mailer.js               # SMTP approver emails (nodemailer; MAIL_DEV/expense-mail/SMTP_*)
│       └── pdf.js                  # Server-side PDF export (pdfkit)
├── app/
│   ├── my-expenses/                # Freestyle SAPUI5 (Employee) — country + inline items
│   │   ├── webapp/                 #   index.html, Component.js, manifest.json,
│   │   │                           #   view/, controller/, model/formatter.js, css/, i18n/
│   │   ├── package.json, ui5.yaml  #   CF build (ui5-task-zipper → my-expenses.zip)
│   └── approval/                   # Freestyle SAPUI5 (Approver+Admin) — 5-section ToolPage side nav
│       ├── webapp/                 #   App + Dashboard/Approvals/Policy/Workflow/History views & controllers
│       └── package.json, ui5.yaml  #   CF build (ui5-task-zipper → approval.zip)
├── test/                           # node:test — 113 passing across 8 suites
│   ├── lifecycle.test.js           # UK 2-level + India 1-level flows, country tax, whoami
│   ├── validate.test.js            # 10 business-rule unit tests
│   ├── approval.test.js            # Approver identity, RBAC, policy edit + audit, workflow
│   ├── dashboard.test.js           # dashboardStats analytics aggregation
│   ├── concurrency.test.js         # draft locks / status-guarded actions (409)
│   ├── edge-cases.test.js          # boundary + error-path coverage
│   ├── odata-contract.test.js      # service metadata / projection shape
│   └── security.test.js            # scope + @restrict enforcement
├── approuter/                      # App Router (xs-app.json) for BTP routing
├── xs-security.json                # XSUAA scopes / roles / collections
├── mta.yaml                        # Multi-Target Application descriptor (BTP deploy)
└── .cdsrc.json                     # CDS config: mocked auth (dev), xsuaa (prod)
```

---

## 12. Getting started (local / SAP Business Application Studio)

**Prerequisites:** Node.js 18+, `@sap/cds-dk` (`npm i -g @sap/cds-dk`).

```bash
git clone https://github.com/SureshRajarathinam/Bluestonex-Expense-V1.git
cd Bluestonex-Expense-V1
npm install
cds watch          # serves both services on an in-memory SQLite DB with seed data
```

Open the served index, then the apps under **Web Applications**. Log in with a mock user:

| User | Password | Role(s) | Approver of |
|---|---|---|---|
| `sabarinathan.chandrasekar@bluestonex.com` | `sab` | all (dev) | — (submits claims) |
| `manager@bluestonex.com` | `mgr` | all (dev) | UK level-1 |
| `Dan.Barton@bluestonex.com` | `dan` | all (dev) | UK level-2 |
| `suresh.rajarathinam@bluestonex.com` | `suresh` | all (dev) | India level-1 |
| `priya.sharma@bluestonex.com` | `priya` | Employee | — (India employee) |
| `clerk@bluestonex.com` | `clerk` | Employee | — (RBAC demo) |

> Tip: apps share one origin and basic-auth caches per origin — use a separate incognito window per role.

**End-to-end demo flow:**
1. **My Expenses** (as `sab`) → Create → choose **UK** or **India** → add inline items + attachments → **Apply for Approval**.
2. **Approvals** → For a **UK** claim, as `manager` approve level-1, then as `Dan.Barton` approve level-2 → **Approved**. For an **India** claim, as `suresh.rajarathinam` approve level-1 → **Approved**.
3. **Policy Configuration** (as `sab`/Admin) → edit a rate → Save. **Approval Workflow Members** → set approvers per country.

---

## 13. Testing

```bash
npm test           # node --test  → 113 passing
```

| Suite | Covers |
|---|---|
| `lifecycle.test.js` | Country-aware tax (VAT vs GST), **UK 2-level** + **India 1-level** flows, country-mandatory guard, receipt-missing block (422), empty-claim block (422), mileage-only success, **`whoami` name greeting** (+ email local-part fallback) |
| `validate.test.js` | Each of the 10 business rules in isolation (success + violation) |
| `approval.test.js` | Approver-identity routing (403 for wrong/non-configured/wrong-level approver), reject-needs-reason, RBAC (403), policy draft-edit + audit, workflow members, double-approve (409), rejected leaves queue (404), history + PDF export, **level-1-approval notification + per-approver email** (submit→L1, UK L1-approve→L2, India single approver, no second email), server net/VAT split |
| `dashboard.test.js` | `dashboardStats` aggregation — approved-only spend, category/claimant/country/trend rollups, date-range + country filtering |
| `concurrency.test.js` | Draft locks (2nd concurrent draftEdit → 409) and status-guarded approve/reject (409) |
| `edge-cases.test.js` | Boundary values and error-path coverage |
| `odata-contract.test.js` | Service metadata / projection shape stability |
| `security.test.js` | XSUAA scope + entity/action `@restrict` enforcement |

All flows are tested for **success and error** paths (422 on missing receipt / future date / over-limit / no country, 403 on wrong role or wrong approver). Email is asserted by spying the notification/mailer singletons — no real SMTP is hit.

---

## 14. Deployment to SAP BTP (Cloud Foundry) + SAP Build Work Zone

Deployed to CF **`bsx-tdd` / `TDD`** (eu10, HANA Cloud).

```bash
npm install -g mbt
mbt build                       # runs `cds build --production` (before-all) → mta_archives/*.mtar
cf deploy mta_archives/*.mtar   # srv + HANA HDI + XSUAA + HTML5 host + 2 apps + subaccount destinations
```

### What the MTA deploys (`mta.yaml`)
- **Modules:** `srv` (CAP), `db-deployer` (HDI tables + CSV seed), `app-deployer` (`com.sap.application.content` → uploads the two app zips to the HTML5 repo; staged via a clean **`resources/`** folder), `destination-content` (creates the subaccount destinations below), and the two `html5` apps.
- **Resources:** `db` (hana `hdi-shared`), `xsuaa` (`application`), `mail` (optional user-provided `expense-mail`), `html5-host` (html5-apps-repo `app-host`), `destination` (`lite`).
- **Deliberately NOT included:** standalone approuter, launchpad/portal, Alert Notification. The apps run under **Work Zone's managed approuter**; ANS was dropped (its `free` plan allows only one instance per subaccount). Production XSUAA JWT validation uses **`@sap/xssec`** (already in `package.json`).

### Work Zone integration (apps into the existing org site)
These are standalone freestyle apps added to the **existing** org Work Zone — the MTA does **not** create its own launchpad site. For that to work, each app `manifest.json` must have:
- `"sap.cloud": { "service": "com.bluestonex.expense", "public": true }` — `public:true` is mandatory; without it the app deploys as **`private`** (`cf html5-list`) and Work Zone's managed approuter (a different space) can't consume it.
- `crossNavigation.inbounds` with a semantic intent + a tile `icon` (also `sap.ui.icons.icon`). **Never** set `sap.flp.type` — the value `"app"` is invalid and blocks content replication.
- A bundled **`xs-app.json`** routing `/expense`·`/approval` → destination `expense-srv-api`, and **relative** backend paths everywhere in the app (`expense/`, not `/expense/`) because the managed approuter mounts each app under a generated prefix and applies xs-app.json routes relative to it.

### Subaccount destinations (created by `destination-content`, or manually)
- **`expense-srv-api`** — `HTTP` → srv URL, `OAuth2UserTokenExchange` (principal propagation via xsuaa), `HTML5.DynamicDestination=true`. How the managed approuter reaches the CAP backend.
- **`expense-management-html5-repo-host`** — app-host registration (`sap.cloud.service`); makes the app-host discoverable in **Cockpit → HTML5 Applications** and Work Zone.

### Post-deploy
1. **Role collections** — assign `Expense_Employee / Approver / Admin` to users (a 403 in prod usually means the collection isn't assigned).
2. **Publish to Work Zone** — **Channel Manager → HTML5 Apps → Fetch updated content** (re-replicates the app-host; check its **Report** if an app is missing — it lists per-app replication errors) → **Content Manager → Content Explorer → HTML5 Apps → Add** the two apps → put them on a **Group/Page** and expose via a **Role** (`Expense_Employee` → My Expenses, `Expense_Approver` → Approval).
3. **Approver emails (SMTP)** — optional `expense-mail`: `cf cups expense-mail -p '{"host":"...","port":587,"user":"...","pass":"...","from":"noreply@bluestonex.com","secure":false}'` then `cf bind-service expense-management-srv expense-mail && cf restart expense-management-srv`. Deploy succeeds without it (mailer no-ops). Locally: `MAIL_DEV=true cds watch`.
4. **USERS_MASTER** (employee-master reuse) is **staged** in `db/external/` (moved out of `db/src/` so HDI doesn't attempt the cross-container grant against the unbound org container). See `db/external/README.md` to activate.

### Deploy gotchas (all resolved — recorded for future deploys)
- `before-all: cds build --production` in `mta.yaml` is required, else `gen/srv` + `gen/db` don't exist on a fresh clone / BAS.
- `app-deployer` must stage into `resources/`, not `app/` (zipping the source dir yields an invalid html5 payload — CODE 1001).
- A failed managed-service create can leave a **phantom instance** that later deploys can't detach (404). Fix: delete/purge it, create a user-provided-service of the same name so the deploy can detach it, then delete it.
- The Cockpit "HTML5 Applications" **direct launch is a static preview** — its `/expense` calls 404 (it doesn't run `xs-app.json`). Verify the backend with `<srv-url>/expense/$metadata` → **401** = healthy.
- **Raw `fetch()` must resolve against the OData service base, never a literal relative path.** Under the managed approuter the app is mounted under a generated prefix, so a bare `fetch("expense/whoami()")` resolves against `document.baseURI` (the launchpad shell), not the app mount → **404**. This does **not** reproduce locally (`cds watch` serves the app at root), which is why dashboard analytics, PDF export, whoami-greeting and claim-journey worked locally but 404'd in Work Zone. Fix: both `BaseController`s expose **`_serviceUrl()`** — it returns the V4 model's already-resolved `getServiceUrl()` (normalised to end in `/`) — and every raw fetch / receipt URL is built from it. The OData model itself resolves `dataSources.uri` correctly for the mount, so borrowing its base is safe. **Rule: never hand-write a relative service path in a `fetch()`; always prefix with `this._serviceUrl()`.**

---

## 15. Tech stack & versions

- **@sap/cds** 8 · **Node.js** 18+ · **OData V4**
- **Freestyle SAPUI5** 1.120+ (XML views + JS controllers, `sap.tnt.ToolPage` shell) · **Horizon** theme + BluestoneX custom CSS
- **SQLite** (`@cap-js/sqlite`) for dev · **SAP HANA Cloud** for production
- **XSUAA** for auth · **SMTP mailer** (`nodemailer`, targeted approver emails); ANS event emission is retained in `notification.js` but **not deployed** (alert-notification `free` plan is 1 instance/subaccount)
- **SAP Build Work Zone, standard edition** — apps surfaced as tiles in the existing org site (managed approuter)

---

## 16. Change history

- **Initial build** — CAP project: data model, services, Fiori apps, MTA descriptor.
- **3-service split & front-end fixes** — role-based services; `Component.js` + FLP-sandbox bootstrap; app annotations in served metadata (fixed blank screens).
- **Business logic** — totals/tax on `SAVE`, all 10 business-rule validations, per-item receipt upload, *Apply for Approval*, audit logging.
- **UK + India restructure** — consolidated to **2 services**; added **country** (UK/IN) on Create with **VAT vs GST** tax; **country-driven approval** (UK two-level, India single-level) via configurable **Approval Workflow Members**; merged Finance + Approver + Admin into the **Approval** area (Approvals · Policy Configuration · Workflow Members); inline multi-item entry on My Expenses; roles simplified to **Employee / Approver / Admin**.
- **Freestyle rewrite** — both front-ends rebuilt as **freestyle SAPUI5** (XML views + JS controllers, `sap.tnt` shell, standard `ComponentContainer`); the four Fiori Elements apps became **two freestyle apps** (My Expenses + a 3-tab Approval app); per-country policies; History tab + server-side PDF export.
- **Live Net/Tax preview** — my-expenses items show a client-derived Net + Tax preview next to Gross (read-only `Policies` projection; `before('SAVE')` remains authoritative).
- **Approver email alerts** — `srv/lib/mailer.js` sends targeted emails to the configured approver (submit→L1, UK L1-approve→L2) via SMTP/`nodemailer`, with a zero-setup `MAIL_DEV` mode and an optional `expense-mail` binding; India L1 approver set to `suresh.rajarathinam@bluestonex.com` (via the EXP-WORKFLOW config table).
- **BTP deploy + Work Zone go-live** — deployed to CF `bsx-tdd/TDD` on **HANA Cloud**; both apps integrated into the existing org **SAP Build Work Zone** via the html5-apps-repo (`sap.cloud.public`, `crossNavigation` + tile icons, **relative** backend paths for the managed approuter, `expense-srv-api` + app-host-registration subaccount destinations). MTA slimmed to drop the standalone approuter, launchpad/portal, and ANS; added the `before-all` CAP build and `resources/` content staging. See **§14**.
- **Error-message surfacing** — a failed V4 bound action inside a `$batch` surfaced only the opaque `"$batch failed"` wrapper; `BaseController.showError` (both apps) now reads the real 4xx text from the UI5 Message Manager. Receipt validation message no longer prints an unmet threshold.
- **Draft-lock fix, validation UX, SoD + QA hardening** — (1) **409 "Entity locked" on Apply for Approval**: a stranded draft (Edit → Back) held the CAP lock; `onSubmit` self-heals by activating the sibling draft then retrying submit. (2) **Real client-side mandatory validation** (Claim Period + item fields) with a consolidated popup (the `required="true"` marks were cosmetic); error surfacing reordered so the 422 is not stripped. (3) **Separation of duties** — approvers cannot approve/reject their **own** claims (403). (4) **`$top`/`$skip`** malformed values rejected 400 (`srv/lib/paging.js`). (5) **Live data** — new mileage-row rate defaults from `Policies.mileageRate`; country Create picker + Dashboard filter bound to `/Countries`. (6) **QA**: suite grown **113 → 151 passing** (`gap-flows`/`gap-admin`/`gap-analytics`/`gap-units`/`receipt-media` + `$top` contract); deliverable in `test/QA-REPORT.md`, runnable requests in `test/expense.http`.
- **Work Zone raw-fetch fix + post-deploy UX pass** — after go-live, several features that worked locally 404'd in Work Zone because raw `fetch()` calls used literal relative paths that resolve against the approuter shell, not the app mount: **Dashboard analytics** ("Could not load analytics"), **History PDF export** (404), whoami-greeting, and claim-journey. All now build their URL from `BaseController._serviceUrl()` (the V4 model's resolved service base) — see the §14 gotcha. Plus UX fixes on My Expenses: **receipt-required popup** on submit + **format restriction** (PNG/JPG/PDF only), **Go button removed** for a multi-field free search (claim no / employee / ID / status), **delete claim** (Draft/Returned/Rejected), and **date/period field spacing**. History KPI badges now count the full filtered set (`_loadCounts`), not just the loaded page.
- **My Expenses UX round 2 + delete guard + approval-confirm popup** — (1) **Claim Period** renders `Jul 1, 2026` (`displayFormat="medium"`). (2) **Item/mileage date value-help**: the `.bsxDateCell` inner `padding-right` override was clipping the `DatePicker` calendar button — removed; both tables now give every column an explicit width with `width="100%"` cells so rows align evenly. (3) **Delete guard**: `MyClaims` had no status-based DELETE protection — added `before('DELETE','MyClaims')` in `expense-service.js` rejecting `Submitted`/`FirstApproved`/`Approved` (409); UI already hid the button for those. (4) **Look-up filter order** on the list = Period → Status → Country → Search. (5) **List empty-state** shrunk to `illustrationSize="Spot"` (removes the dead vertical band). (6) **Apply-for-Approval confirmation popup** that **names the country approver**: new read-only `ExpenseService.approverFor(country)` function (returns `WORKFLOW.firstApprover`), resolved client-side via the **OData function import** (not raw fetch); on confirm the existing submit runs and the backend emails that approver (SMTP already bound in TDD). Suite **153 pass** (+delete-guard 409 and `approverFor` tests).

---

*Living documentation. Backend logic and all flows are covered by `npm test` (**153 pass**, 1 skip, 1 todo). Fiori UI rendering should be verified in a browser against `cds watch`.*
