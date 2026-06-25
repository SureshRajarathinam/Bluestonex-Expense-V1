# BluestoneX Expense Reimbursement System

A modern, end-to-end **Expense Reimbursement System** built on **SAP Cloud Application Programming Model (CAP)** with **SAP Fiori** front-ends, designed to run on **SAP BTP**.

> **Stack:** SAP CAP (Node.js) · OData V4 · SAP Fiori Elements + freestyle SAPUI5 · SQLite (dev) / SAP HANA Cloud (prod) · XSUAA · BTP Alert Notification Service
> **Status:** 4 apps · 4 OData services · **30/30 automated tests passing** (`npm test`)

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

Four role-based Fiori apps on the BTP Launchpad, backed by a CAP OData V4 service layer:

- **My Expenses** — employees create, attach receipts, and *apply* (submit) claims.
- **Approve Expenses** — line managers approve/reject applied claims.
- **Finance Expenses** — finance gives final sign-off and settles for payroll.
- **Expense Administration** — admins manage policy, users/roles, and view the audit log.

Policy is enforced centrally (10 business rules), receipts are mandatory above a configurable threshold, and every state change is written to an audit log.

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        SAP BTP Launchpad (FLP)                         │
│                                                                        │
│  My Expenses     Approve Expenses    Finance Expenses   Expense Admin  │
│  (Fiori El.)     (Fiori Elements)    (Fiori Elements)   (freestyle,    │
│  Employee        Manager             Finance             3 tabs) Admin │
└─────┬───────────────┬──────────────────┬───────────────────┬──────────┘
      │ /expense       │ /approval        │ /finance          │ /admin
┌─────▼───────────────▼──────────────────▼───────────────────▼──────────┐
│                     CAP Services (Node.js · OData V4)                   │
│  ExpenseService   ApprovalService   FinanceService      AdminService    │
│  draft-enabled    read+actions      read+actions        policy/users/   │
│  submit           approve/reject    fin-approve/settle  audit           │
│        └────── shared libs: calc · validate · load-claim · audit ───────┘
│                          notification → BTP Alert Notification Service  │
└────────────────────────────────┬───────────────────────────────────────┘
                                  │ CDS model (db/schema.cds)
                    ┌─────────────▼──────────────┐
                    │  SQLite (dev) / HANA (prod) │
                    └─────────────────────────────┘
```

Each role gets its **own service** projecting the same underlying entities exactly once — this avoids OData redirection conflicts and keeps security boundaries clean.

---

## 4. The four apps

| App | Path | Type | Role | Purpose |
|---|---|---|---|---|
| **My Expenses** | `/my-expenses` → `/expense` | Fiori Elements (List Report + Object Page, draft) | Employee | Create claims, add items/mileage, upload receipts, **Apply for Approval** |
| **Approve Expenses** | `/approve-expenses` → `/approval` | Fiori Elements (LR + OP) | Manager | Review applied claims, view receipts, **Approve / Reject** |
| **Finance Expenses** | `/finance-expenses` → `/finance` | Fiori Elements (LR + OP) | Finance | **Finance Approve / Settle / Reject** approved claims |
| **Expense Administration** | `/admin-console` → `/admin` | Freestyle SAPUI5 (3-tab `IconTabBar`) | Admin | Policy config · user & role management · audit log |

> Fiori Elements is one-entity-per-app, so the admin app (which spans policy + users + audit) is a **freestyle** SAPUI5 app with tabs.

---

## 5. Claim lifecycle

```
   ┌─────────┐  Apply   ┌───────────┐  Manager   ┌─────────────────┐  Finance   ┌─────────────────┐  Settle  ┌──────────┐
   │  Draft  │ ───────▶ │ Submitted │ ─────────▶ │ ManagerApproved │ ─────────▶ │ FinanceApproved │ ───────▶ │ Settled  │
   └─────────┘ (submit) └───────────┘ (approve)  └─────────────────┘ (approve)  └─────────────────┘          └──────────┘
        ▲                    │  reject (reason)        │  reject (reason)
        │                    ▼                         ▼
        └──────────────  ┌──────────┐  ◀───────────────┘
        (edit & re-apply)│ Rejected │
                         └──────────┘
```

**Visibility gating (enforced server-side):**
- Managers see only **applied** claims — drafts are hidden (`status <> 'Draft'`).
- Finance sees only **manager-approved onward** (`ManagerApproved`, `FinanceApproved`, `Settled`).
- A rejection **requires a reason** (manager or finance).
- The status drives Fiori colour coding via a computed `statusCriticality`.

---

## 6. Data model (`db/schema.cds`)

| Entity | Notes |
|---|---|
| `ExpenseClaims` | Header: claimNumber, employee, payrollArea, claimPeriod, status, totals (net/VAT/gross), approval trail. Compositions to items & mileage. |
| `ExpenseItems` | Dated line items: type, destination, reason, VAT type, gross → **net/VAT split**, receipt media. |
| `MileageClaims` | Trip date, destination, reason, engine type, miles × rate = total. |
| `Employees` | Master data: number, name, email, site, dept, payroll area, **role**, active flag. |
| `ExpensePolicy` | mileageRate (£0.25), hotelDailyLimit (£200), mealDailyLimit (£40), **receiptThreshold (£25)**, vatRate (20%). |
| `AuditLog` | Append-only trail: timestamp, user, action, object type/key, details. |
| Code lists | `ExpenseTypes` (HOTEL, FOOD, TRAIN, TAXI, …), `VATTypes` (STD/ZR/EX), `Roles` (Employee/Manager/Finance/Admin). |

**Computation:** VAT split per item, mileage totals, and claim roll-ups are computed in a **`before('SAVE')`** handler (the draft-correct hook) using the pure, unit-tested `srv/lib/calc.js`.

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
| 9 | Rejected claims require a rejection reason | approval/finance reject actions → 422 |
| 10 | Finance approval requires verified totals & policy compliance | `financeApprove` re-runs `validate.js` |

---

## 8. Receipt photo upload

- **Per expense item**, using SAP CAP media handling (`receipt : LargeBinary` with `@Core.MediaType`, `@Core.ContentDisposition`).
- Employees upload a photo/PDF on the **item detail page** (My Expenses).
- **Mandatory** when an item's gross is at/above the policy `receiptThreshold` (or the expense type requires it) — submission is blocked until attached.
- Managers and finance get a **View Receipt** download link and a Receipt section on the item detail page.

---

## 9. Roles & security

Defined in **`xs-security.json`** (XSUAA) — scopes, role templates, and role collections:

| Role collection | Scope | Can |
|---|---|---|
| `Expense_Employee` | `Employee` | Own claims (`employeeEmail = $user`) |
| `Expense_Manager` | `Manager` (+Employee) | Approve/reject team claims |
| `Expense_Finance` | `Finance` (+Employee) | Finance approve / settle / reject |
| `Expense_Admin` | `Admin` | Policy, users/roles, audit |

- Services use service-level `@requires` (metadata readable by authenticated users so apps render) with entity/action-level `@restrict` for actual data access.
- **Every workflow transition and admin change is written to the audit log** (`srv/lib/audit.js`, additive — no change to workflow logic).
- **Dev note:** local mocked auth (`.cdsrc.json`) grants the demo users *all* roles for one-login convenience; production keeps roles strictly separate via XSUAA. A dedicated `clerk` (Employee-only) user backs the RBAC tests.

---

## 10. Expense Administration app (one app, three tabs)

| Tab | What it does |
|---|---|
| **Policy Configuration** | Form bound to the policy — change mileage rate / limits / receipt threshold → **Save** (or Cancel). Feeds straight into the rules engine. |
| **User Management** | Inline-editable table — **Create** users, edit name/email/**Role**/Active, **Delete**, **Save**. Email validated. |
| **Audit Log** | Read-only, newest first. Entries appear as claims are submitted/approved/settled/rejected and when policy/users change. |

Built freestyle (V4 `ODataModel`, deferred `updateGroupId: 'adminChanges'` → `submitBatch` on Save; immediate delete via `$auto`).

---

## 11. Project structure

```
.
├── db/
│   ├── schema.cds                  # All entities, code lists, labels, media annotations
│   └── data/*.csv                  # Seed data (employees, policy, types, roles)
├── srv/
│   ├── expense-service.{cds,js}    # Employee service  (/expense) — draft, submit
│   ├── approval-service.{cds,js}   # Manager service   (/approval) — approve/reject
│   ├── finance-service.{cds,js}    # Finance service   (/finance)  — approve/settle/reject
│   ├── admin-service.{cds,js}      # Admin service     (/admin)    — policy/users/audit
│   ├── notification.js             # BTP Alert Notification Service integration
│   └── lib/
│       ├── calc.js                 # VAT split, mileage, claim totals (pure)
│       ├── validate.js             # All 10 business rules (pure)
│       ├── load-claim.js           # Validation context loader
│       └── audit.js                # Audit-log writer
├── app/
│   ├── my-expenses/                # Fiori Elements app + annotations
│   ├── approve-expenses/           # Fiori Elements app + annotations
│   ├── finance-expenses/           # Fiori Elements app + annotations
│   ├── admin-console/              # Freestyle SAPUI5 app (3 tabs)
│   └── services.cds                # Aggregates app UI annotations into the model
├── test/
│   ├── lifecycle.test.js           # End-to-end workflow, visibility, receipts, RBAC
│   ├── validate.test.js            # 10 business-rule unit tests
│   └── admin.test.js               # Admin CRUD, RBAC, audit
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
cds watch          # serves all 4 services on an in-memory SQLite DB with seed data
```

Open the served index, then the apps under **Web Applications**. Log in with a mock user:

| User | Password | Primary use |
|---|---|---|
| `sabarinathan.chandrasekar@bluestonex.com` | `sab` | Everything (all roles in dev) |
| `manager@bluestonex.com` | `mgr` | Approve Expenses |
| `Dan.Barton@bluestonex.com` | `dan` | Finance Expenses |
| `clerk@bluestonex.com` | `clerk` | Employee-only (RBAC demo) |

> Tip: apps share one origin and basic-auth caches per origin — use a separate incognito window per role, or just use `sab` (all roles) for a single-login demo.

**End-to-end demo flow** (as `sab`):
1. **My Expenses** → Create → add an item → upload a receipt → **Apply for Approval**.
2. **Approve Expenses** → the applied claim appears → open it, View Receipt → **Approve**.
3. **Finance Expenses** → the approved claim appears → **Finance Approve** → **Settle**.
4. **Expense Administration** → Policy/Users/Audit tabs (the audit log shows each step).

---

## 13. Testing

```bash
npm test           # node --test  → 30/30 passing
```

| Suite | Covers |
|---|---|
| `lifecycle.test.js` | Calculations, draft→submit→approve→finance→settle, reject-with-reason, **visibility gating**, receipt upload, RBAC (403), one-login cross-app flow, metadata sanity |
| `validate.test.js` | Each of the 10 business rules in isolation (success + violation) |
| `admin.test.js` | Policy read/edit + audit, invalid-policy rejection, user create/edit/role + email validation, workflow-audit write, admin RBAC |

All flows are tested for **success and error** paths (e.g. 422 on missing receipt / future date / over-limit, 409 on out-of-order transitions, 403 on wrong role).

---

## 14. Deployment to SAP BTP (Cloud Foundry)

```bash
npm install -g mbt
mbt build                       # produces mta_archives/*.mtar
cf deploy mta_archives/*.mtar   # deploys srv + HANA + XSUAA + ANS + HTML5 repo + approuter + launchpad
```

Post-deploy:
1. **XSUAA** — assign the role collections (`Expense_Employee/Manager/Finance/Admin`) to users.
2. **Alert Notification Service** — in BTP Cockpit, create Conditions (by `eventType`, e.g. `ExpenseClaim.Submitted`) + Email Actions + Subscriptions. The backend fires events automatically; ANS routes the emails.
3. **Launchpad** — register the HTML5 content provider; the app tiles appear and can be grouped under *Employee Self Service*.

`mta.yaml` already declares all modules/resources (CAP service, HANA HDI, XSUAA, ANS, HTML5 host/runtime, destination, approuter, launchpad).

---

## 15. Tech stack & versions

- **@sap/cds** 8 · **Node.js** 18+ · **OData V4**
- **SAP Fiori Elements** + **freestyle SAPUI5** 1.120 · **Horizon** theme
- **SQLite** (`@cap-js/sqlite`) for dev · **SAP HANA Cloud** for production
- **XSUAA** for auth · **BTP Alert Notification Service** for email notifications

---

## 16. Change history

- **Initial build** — CAP project: data model, services, 3 Fiori apps, MTA descriptor.
- **3-service split** — separate `ExpenseService` / `ApprovalService` / `FinanceService` to resolve OData redirection conflicts.
- **Front-end fixes** — added `Component.js` per app; switched to the FLP-sandbox bootstrap; included app UI annotations in served metadata (fixing blank screens); fixed the Fiori preview crash.
- **Runtime correctness** — totals/VAT computed on `SAVE`; normalised bound-action keys; verified with an automated test suite.
- **Phase 1** — auto-derive employee from the logged-in user (fixed "Employee ID required").
- **Phase 2** — all 10 business-rule validations.
- **Phase 3** — per-item receipt photo upload (CAP media).
- **Workflow UX** — *Apply for Approval* button, status-based visibility gating, Object Page header actions, receipt viewing for approver/finance, SAP-standard responsive tables.
- **Admin** — consolidated **Expense Administration** app (one app, three tabs: Policy / Users / Audit) with additive audit logging.

---

*Generated as living documentation of the project to date. Backend logic and all flows are covered by `npm test` (30/30). Fiori UI rendering should be verified in a browser against `cds watch`.*
