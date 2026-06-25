# CLAUDE.md — project context for AI sessions

> Full documentation is in **[README.md](README.md)**. This file is the quick, always-loaded summary.

## What this is
BluestoneX **Expense Reimbursement System** — SAP CAP (Node.js) + Fiori Elements, for SAP BTP.
Supports **UK and India** employees with country-aware tax and approval routing.

## Commands
```bash
npm install        # install deps
cds watch          # run locally (in-memory SQLite + seed data), serves both services
npm test           # node --test — 23/23 must stay green after any change
mbt build && cf deploy mta_archives/*.mtar   # BTP deploy
```

## Apps & services (2 services, 4 FE apps)
- `/expense`  → `ExpenseService`  (Employee, draft, submit)            → app `my-expenses`
- `/approval` → `ApprovalService` (merged: approvals + config)         → apps:
  - `approvals`        (entitySet `Approvals`, role **Approver**) — approve/reject
  - `policy-config`    (entitySet `Policies`, role **Admin**, draft)  — VAT/GST/limits
  - `workflow-members` (entitySet `WorkflowMembers`, role **Admin**, draft) — approvers per country
- All apps are **Fiori Elements** (List Report + Object Page). No freestyle.

## Country-aware behaviour
- Claim has a **`country`** (UK | IN), chosen on Create (mandatory).
- Tax: UK → `ExpensePolicy.vatRate` (VAT), India → `ExpensePolicy.gstRate` (GST). Picked in `srv/lib/calc.js` `taxRateFor()`, applied in `expense-service.js before('SAVE')`. Field names stay `vatType/vatAmount/totalVAT` (hold the country tax); UI labels say "Tax". Currency GBP (UK) / INR (IN).
- Approval routing from **`ApprovalWorkflow`** (seed: UK first=manager@, second=Dan.Barton@; IN first=manager@):
  - **UK = 2-level**: `Submitted → FirstApproved → Approved`
  - **India = 1-level**: `Submitted → Approved`
  - (+ `Draft`, `Rejected`). No "Settled" step.
- `approve`/`reject` actions verify the caller **is the configured approver** for that level+country (403 otherwise) — routing is per-person, not per-role.

## Key files
- `db/schema.cds` — entities incl. `Countries`, `ApprovalWorkflow`; claim has `country` + generic `level1*/level2*/rejected*` trail.
- `srv/lib/calc.js` (`taxRateFor`, `splitVAT(gross, taxType, rate)`), `validate.js` (10 rules), `load-claim.js`, `audit.js`.
- `app/services.cds` — MUST `using` each FE app's annotations (my-expenses, approvals, policy-config, workflow-members) or UI annotations won't reach `$metadata` (blank apps).

## Conventions / gotchas (learned the hard way)
- Fiori app `index.html` uses the **FLP ushell-sandbox** bootstrap; each app needs a `Component.js` extending `sap/fe/core/AppComponent`.
- Bound-action key: `req.params[0]` is `{ID}` for draft entities, a raw scalar for non-draft — normalise via `idOf()`.
- VAT/totals computed in `before('SAVE')` (draft requirement), NOT per-item handlers.
- My Expenses items are **inline** on the claim Object Page (manifest `controlConfiguration … creationMode: InlineCreationRows`) — no item sub-page. Receipt is an inline media column.
- After any change: `npm test` and `npx cds compile srv db app -s all --to edmx-v4 -o /tmp/x` (warning-free).

## Mock logins (dev — all have Employee+Approver+Admin except clerk/priya)
`sab`/`sab` · `manager`/`mgr` (UK L1 + IN L1) · `Dan.Barton`/`dan` (UK L2) · `clerk`/`clerk` (employee-only) · `priya.sharma`/`priya` (India employee)

## Repo
https://github.com/SureshRajarathinam/Bluestonex-Expense-V1
