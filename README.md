# BluestoneX Expense Reimbursement System

A modern, end-to-end **Expense Reimbursement System** built on **SAP Cloud Application Programming Model (CAP)** with **SAP Fiori** front-ends, designed to run on **SAP BTP**.

> **Stack:** SAP CAP (Node.js) · OData V4 · SAP Fiori Elements · SQLite (dev) / SAP HANA Cloud (prod) · XSUAA · BTP Alert Notification Service
> **Status:** **UK & India** support · 4 Fiori Elements apps · 2 OData services · **23/23 automated tests passing** (`npm test`)

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

- **My Expenses** (`/expense`) — employees pick **UK or India** on Create, enter **multiple items inline** on one page with **per-item attachments**, and *Apply* (submit). Tax is **VAT (UK)** or **GST (India)** from config.
- **Approval area** (`/approval`) — three Fiori Elements apps on one service:
  - **Approvals** (Approver) — approve/reject pending claims.
  - **Policy Configuration** (Admin) — VAT/GST rates, mileage rate, limits, receipt threshold.
  - **Approval Workflow Members** (Admin) — the approvers per country.

Approval routing is **country-driven**: **UK = two-level** (L1 → L2), **India = single-level** (L1). Policy is enforced centrally (10 business rules), receipts are mandatory above a configurable threshold, and every state change is written to an audit log.

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        SAP BTP Launchpad (FLP)                         │
│                                                                        │
│  My Expenses        Approvals      Policy Config    Workflow Members   │
│  (Fiori Elements)   (Fiori El.)    (Fiori El.)      (Fiori Elements)   │
│  Employee           Approver       Admin            Admin              │
└─────┬───────────────────┴──────────────┴───────────────┴──────────────┘
      │ /expense                    │ /approval
┌─────▼─────────────────┐  ┌────────▼───────────────────────────────────┐
│   ExpenseService      │  │           ApprovalService                   │
│   draft · submit      │  │  Approvals (approve/reject, country routing) │
│   country-aware tax   │  │  Policies · WorkflowMembers · AuditLogs      │
└───────────┬───────────┘  └───────────────────┬─────────────────────────┘
            └─── shared libs: calc · validate · load-claim · audit ───┘
                    notification → BTP Alert Notification Service
                                  │ CDS model (db/schema.cds)
                    ┌─────────────▼──────────────┐
                    │  SQLite (dev) / HANA (prod) │
                    └─────────────────────────────┘
```

---

## 4. The apps

| App | Path | Type | Role | Purpose |
|---|---|---|---|---|
| **My Expenses** | `/my-expenses` → `/expense` | Fiori Elements (LR + OP, draft) | Employee | Pick country, add **inline** items + attachments, **Apply for Approval** |
| **Approvals** | `/approvals` → `/approval` | Fiori Elements (LR + OP) | Approver | Review pending claims, view receipts, **Approve / Reject** |
| **Policy Configuration** | `/policy-config` → `/approval` | Fiori Elements (LR + OP, draft) | Admin | Edit VAT/GST rates, mileage rate, limits, receipt threshold |
| **Approval Workflow Members** | `/workflow-members` → `/approval` | Fiori Elements (LR + OP, draft) | Admin | Configure L1/L2 approvers per country |

> Fiori Elements is one-entity-per-app, so the "Approval" area is delivered as three FE apps (tiles) over one `/approval` service — grouped together on the launchpad.

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
| Code lists | `Countries` (UK/IN), `ExpenseTypes`, `VATTypes`, `Roles` (Employee/Approver/Admin). |

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

## 10. The Approval area (3 Fiori Elements apps on `/approval`)

| App | What it does |
|---|---|
| **Approvals** | List of claims pending the user's decision → Object Page (items, mileage, receipts) → **Approve / Reject** (Reject prompts for a reason). UK needs L1 then L2; India needs L1 only. |
| **Policy Configuration** | Open the policy → **Edit** → change VAT/GST rate, mileage rate, limits, receipt threshold → **Save** (draft flow). Feeds the rules + tax engine. |
| **Approval Workflow Members** | Per country, set the **first-level** and **second-level** (UK) approver emails. |

---

## 11. Project structure

```
.
├── db/
│   ├── schema.cds                  # Entities, code lists, ApprovalWorkflow, labels, media
│   └── data/*.csv                  # Seed (employees, policy, countries, workflow, types, roles)
├── srv/
│   ├── expense-service.{cds,js}    # Employee service (/expense) — draft, country tax, submit
│   ├── approval-service.{cds,js}   # Merged service  (/approval) — approve/reject, policy, workflow, audit
│   ├── notification.js             # BTP Alert Notification Service integration
│   └── lib/
│       ├── calc.js                 # taxRateFor, VAT/GST split, mileage, totals (pure)
│       ├── validate.js             # All 10 business rules (pure)
│       ├── load-claim.js           # Validation context loader
│       └── audit.js                # Audit-log writer
├── app/
│   ├── my-expenses/                # FE app (Employee) — country + inline items
│   ├── approvals/                  # FE app (Approver)
│   ├── policy-config/              # FE app (Admin)
│   ├── workflow-members/           # FE app (Admin)
│   └── services.cds                # Aggregates app UI annotations into the model
├── test/
│   ├── lifecycle.test.js           # UK 2-level + India 1-level flows, country tax
│   ├── validate.test.js            # 10 business-rule unit tests
│   └── approval.test.js            # Approver identity, RBAC, policy edit + audit, workflow
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
| `manager@bluestonex.com` | `mgr` | all (dev) | UK level-1 + India level-1 |
| `Dan.Barton@bluestonex.com` | `dan` | all (dev) | UK level-2 |
| `priya.sharma@bluestonex.com` | `priya` | Employee | — (India employee) |
| `clerk@bluestonex.com` | `clerk` | Employee | — (RBAC demo) |

> Tip: apps share one origin and basic-auth caches per origin — use a separate incognito window per role.

**End-to-end demo flow:**
1. **My Expenses** (as `sab`) → Create → choose **UK** or **India** → add inline items + attachments → **Apply for Approval**.
2. **Approvals** → as `manager` approve level-1. For a **UK** claim, then as `Dan.Barton` approve level-2 → **Approved**. For an **India** claim, level-1 completes it.
3. **Policy Configuration** (as `sab`/Admin) → edit a rate → Save. **Approval Workflow Members** → set approvers per country.

---

## 13. Testing

```bash
npm test           # node --test  → 23/23 passing
```

| Suite | Covers |
|---|---|
| `lifecycle.test.js` | Country-aware tax (VAT vs GST), **UK 2-level** + **India 1-level** flows, country-mandatory guard |
| `validate.test.js` | Each of the 10 business rules in isolation (success + violation) |
| `approval.test.js` | Approver-identity routing (403 for wrong/non-configured approver), reject-needs-reason, RBAC (403), policy draft-edit + audit, workflow members |

All flows are tested for **success and error** paths (422 on missing receipt / future date / over-limit / no country, 403 on wrong role or wrong approver).

---

## 14. Deployment to SAP BTP (Cloud Foundry)

```bash
npm install -g mbt
mbt build                       # produces mta_archives/*.mtar
cf deploy mta_archives/*.mtar   # deploys srv + HANA + XSUAA + ANS + HTML5 repo + approuter + launchpad
```

Post-deploy:
1. **XSUAA** — assign the role collections (`Expense_Employee/Approver/Admin`) to users.
2. **Alert Notification Service** — in BTP Cockpit, create Conditions (by `eventType`, e.g. `ExpenseClaim.Submitted`) + Email Actions + Subscriptions. The backend fires events automatically; ANS routes the emails.
3. **Launchpad** — register the HTML5 content provider; group the **Approvals / Policy Configuration / Approval Workflow Members** tiles together (e.g. under *Expense Approval*).

`mta.yaml` already declares all modules/resources (CAP service, HANA HDI, XSUAA, ANS, HTML5 host/runtime, destination, approuter, launchpad).

---

## 15. Tech stack & versions

- **@sap/cds** 8 · **Node.js** 18+ · **OData V4**
- **SAP Fiori Elements** 1.120 · **Horizon** theme
- **SQLite** (`@cap-js/sqlite`) for dev · **SAP HANA Cloud** for production
- **XSUAA** for auth · **BTP Alert Notification Service** for email notifications

---

## 16. Change history

- **Initial build** — CAP project: data model, services, Fiori apps, MTA descriptor.
- **3-service split & front-end fixes** — role-based services; `Component.js` + FLP-sandbox bootstrap; app annotations in served metadata (fixed blank screens).
- **Business logic** — totals/tax on `SAVE`, all 10 business-rule validations, per-item receipt upload, *Apply for Approval*, audit logging.
- **UK + India restructure (current)** — consolidated to **2 services / 4 Fiori Elements apps**; added **country** (UK/IN) on Create with **VAT vs GST** tax; **country-driven approval** (UK two-level, India single-level) via configurable **Approval Workflow Members**; merged Finance + Approver + Admin into the **Approval** area (Approvals · Policy Configuration · Workflow Members); inline multi-item entry on My Expenses; roles simplified to **Employee / Approver / Admin**.

---

*Living documentation. Backend logic and all flows are covered by `npm test` (23/23). Fiori UI rendering should be verified in a browser against `cds watch`.*
