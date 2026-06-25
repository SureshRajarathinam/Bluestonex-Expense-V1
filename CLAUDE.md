# CLAUDE.md — project context for AI sessions

> Full documentation is in **[README.md](README.md)** — read it for architecture, data model, all 10 business rules, apps, and deployment. This file is the quick, always-loaded summary.

## What this is
BluestoneX **Expense Reimbursement System** — SAP CAP (Node.js) + Fiori, for SAP BTP.
Replaces a manual Excel expense-claim process with a digital, policy-enforced, audited workflow.

## Commands
```bash
npm install        # install deps
cds watch          # run locally (in-memory SQLite + seed data), serves all 4 services
npm test           # node --test — 30/30 must stay green after any change
mbt build && cf deploy mta_archives/*.mtar   # BTP deploy
```

## Architecture (one service per role — never merge them)
- `/expense`  → `ExpenseService`  (Employee, draft-enabled, submit)        → app `my-expenses`
- `/approval` → `ApprovalService` (Manager, approve/reject)                → app `approve-expenses`
- `/finance`  → `FinanceService`  (Finance, fin-approve/settle/reject)     → app `finance-expenses`
- `/admin`    → `AdminService`    (Admin, policy/users/audit, non-draft)   → app `admin-console` (freestyle, 3 tabs)

Claim status: `Draft → Submitted → ManagerApproved → FinanceApproved → Settled` (+ `Rejected`).
Visibility: managers see `status<>Draft`; finance sees `ManagerApproved+`.

## Key files
- `db/schema.cds` — all entities + media + labels; `db/data/*.csv` — seed.
- `srv/lib/calc.js` — VAT/mileage/totals (computed in `before('SAVE')`, NOT per-item handlers — draft requirement).
- `srv/lib/validate.js` — all 10 business rules (pure); used by `submitClaim` + `financeApprove`.
- `srv/lib/audit.js` — audit-log writer (additive).
- `app/services.cds` — MUST `using` each app's annotations or UI annotations won't reach served `$metadata` (blank apps).

## Conventions / gotchas (learned the hard way)
- Fiori app `index.html` uses the **FLP ushell-sandbox** bootstrap; each app needs a `Component.js`.
- Bound-action key: `req.params[0]` is an object `{ID}` for draft entities, a raw scalar for non-draft — normalise it.
- Dev mock users (`.cdsrc.json`) have ALL roles for one-login demo; prod uses strict XSUAA roles. `clerk`/`clerk` is Employee-only for RBAC tests.
- After any backend change, run `npm test` and `npx cds compile srv db app -s all --to edmx-v4 -o /tmp/x` (must be warning-free).

## Mock logins (dev)
`sab`/`sab` (all roles) · `manager`/`mgr` · `Dan.Barton`/`dan` · `clerk`/`clerk` (employee-only)

## Repo
https://github.com/SureshRajarathinam/Bluestonex-Expense-V1
