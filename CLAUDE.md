# CLAUDE.md — project context for AI sessions

> Full documentation is in **[README.md](README.md)**. This file is the quick, always-loaded summary.

## What this is
BluestoneX **Expense Reimbursement System** — SAP CAP (Node.js) backend + **freestyle SAPUI5** (XML views + JS controllers) front-ends, for SAP BTP.
Supports **UK and India** employees with country-aware tax and approval routing.

## Commands
```bash
npm install        # install deps
cds watch          # run locally (in-memory SQLite + seed data), serves both services
npm test           # node --test — 113 must stay green after any change
mbt build && cf deploy mta_archives/*.mtar   # BTP deploy (CF bsx-tdd/TDD) — see Deployment section
```

## Apps & services (2 services, 2 freestyle apps)
- `/expense`  → `ExpenseService`  (Employee, draft, submit) → app **`my-expenses`** (`com.bluestonex.expense.myexpenses`)
  - List of own claims → **Create** opens a country dialog (UK/India) → single-page claim detail with **inline** expense-item + mileage tables (Add/Delete rows on the same screen, no sub-page) + per-item receipt upload → Save (draftActivate) / Apply for Approval (submitClaim).
  - Items table shows a **live Net + Tax preview** next to Gross: derived client-side via `formatter.netPreview/vatPreview` from the country's rate (read-only `Policies` projection), mirroring `calc.js splitVAT`. Preview only — `before('SAVE')` stays authoritative. (Formatters must NOT use `this` — a `.formatter.x` XML ref is bound to the controller, not the module.)
- `/approval` → `ApprovalService` (merged) → app **`approval`** (`com.bluestonex.expense.approval`), one app with a **3-tab IconTabBar**:
  - **Approvals** (entitySet `Approvals`, role **Approver**) — review dialog + approve/reject
  - **Policy Configuration** (entitySet `Policies`, role **Admin**, draft) — VAT/GST/limits
  - **Approval Workflow Members** (entitySet `WorkflowMembers`, role **Admin**, draft) — approvers per country
- Both apps are **freestyle SAPUI5**: `sap.tnt.ToolPage` shell (header + side nav), BluestoneX theme in `webapp/css/style.css`, OData V4 `ODataModel`. Bootstrap = standard `ComponentContainer` (NOT FLP ushell sandbox). In Work Zone they run under the **managed approuter** (mounted under a generated prefix), so all backend paths are **relative** (no leading slash) — see Deployment.

## Deployment (BTP Cloud Foundry + SAP Build Work Zone)
Deployed to CF **bsx-tdd / TDD** (eu10, HANA Cloud). Build+deploy: `mbt build && cf deploy mta_archives/*.mtar`. Full runbook + gotchas in **[README.md](README.md)** and the auto-memory `deployment-btp`.
- **MTA** (`mta.yaml`): top-level `before-all` runs `cds build --production` (so `gen/` exists on a fresh clone/BAS). Modules: `srv`, `db-deployer` (hdb), `app-deployer` (`com.sap.application.content` → html5-host, staged via a clean **`resources/`** folder — never `app/`), `destination-content` (subaccount destinations), 2 `html5` apps. Resources: `db` (hana/hdi-shared), `xsuaa`, `mail` (optional `expense-mail`), `html5-host` (app-host), `destination`. **No standalone approuter, no launchpad/portal, no ANS** (alert-notification free plan is capped at 1 instance/subaccount).
- **Work Zone model:** apps are added to the **existing org Work Zone** (not their own site). Per-app manifest requirements: `"sap.cloud": { "service": "com.bluestonex.expense", "public": true }` (flat `sap.cloud.service` or missing `public` → deploys **`private`**, unconsumable by Work Zone's managed approuter which runs in another space); `crossNavigation.inbounds` + tile `icon` (+ `sap.ui.icons.icon`); **do NOT add `sap.flp.type`** (`"app"` is invalid → channel replication fails). Each app bundles `xs-app.json` routing `/expense`·`/approval` → destination **`expense-srv-api`**.
- **Backend paths must be RELATIVE** (`expense/` not `/expense/`) in `dataSources.uri`, the whoami fetch, `SVC`, receipt/CSRF, export — the managed approuter mounts the app under a prefix and only applies xs-app.json routes relative to it. Keep the leading slash ONLY on the xs-app.json route `target`.
- **Subaccount destinations** (created by `destination-content` at `content.subaccount` scope, or manually): `expense-srv-api` (OAuth2UserTokenExchange → srv URL, `HTML5.DynamicDestination=true`) + `expense-management-html5-repo-host` (app-host registration, `sap.cloud.service`) — the latter is what makes the app-host discoverable in Cockpit → HTML5 Applications and Work Zone.
- **Post-deploy:** Channel Manager → HTML5 Apps → **Fetch updated content** (re-replicate; check its **Report** if an app is missing) → Content Manager → add apps to a Group/Page → Role → assign XSUAA role-collections (`Expense_Employee` / `Expense_Approver` / `Expense_Admin`). USERS_MASTER integration is **staged** in `db/external/` (not `db/src/` — its hdbgrants/hdbsynonym would fail HDI against the unbound org container); see `db/external/README.md`.

## Country-aware behaviour
- Claim has a **`country`** (UK | IN), chosen on Create (mandatory).
- Tax: UK → `ExpensePolicy.vatRate` (VAT), India → `ExpensePolicy.gstRate` (GST). Picked in `srv/lib/calc.js` `taxRateFor()`, applied in `expense-service.js before('SAVE')`. Field names stay `vatType/vatAmount/totalVAT` (hold the country tax); UI labels say "Tax". Currency GBP (UK) / INR (IN).
- Approval routing from **`ApprovalWorkflow`** (seed: UK first=manager@, second=Dan.Barton@; IN first=yuvaraj.kumar@):
  - **UK = 2-level**: `Submitted → FirstApproved → Approved`
  - **India = 1-level**: `Submitted → Approved`
  - (+ `Draft`, `Rejected`). No "Settled" step.
- `approve`/`reject` actions verify the caller **is the configured approver** for that level+country (403 otherwise) — routing is per-person, not per-role.
- **Approver email alerts** (`srv/lib/mailer.js`, called from `notification.js`): submit → email the country's first-level approver; UK `Submitted→FirstApproved` → email the second-level approver; India single-level fires no second email. SMTP from a bound `expense-mail` service or `SMTP_*` env; **`MAIL_DEV=true`** uses a throwaway Ethereal inbox and logs a preview URL; with none configured it's a logged no-op. `sendMail` never throws (can't break approve/submit). ANS event emission is kept alongside.

## Key files
- `db/schema.cds` — entities incl. `Countries`, `ApprovalWorkflow`; claim has `country` + generic `level1*/level2*/rejected*` trail.
- `srv/lib/calc.js` (`taxRateFor`, `splitVAT(gross, taxType, rate)`), `validate.js` (10 rules), `load-claim.js`, `audit.js`, `mailer.js` (SMTP/nodemailer approver emails). `srv/notification.js` = ANS events + mailer calls.
- `srv/expense-service.cds` exposes a read-only `Policies` projection so the my-expenses UI can read the country tax rate for the Net/Tax preview.
- `app/<app>/webapp/` — freestyle: `index.html` (ComponentContainer), `Component.js` (extends `UIComponent`), `manifest.json` (V4 model + rootView), `view/*.xml`, `controller/*.js` (BaseController has a `callAction` wrapper), `model/formatter.js`, `css/style.css`, `i18n/`.
- There is **no `app/services.cds`** and no per-app `annotations.cds` — freestyle needs no UI annotations in `$metadata`.

## Conventions / gotchas (learned the hard way)
- Freestyle bootstrap: `index.html` declares the UI5 `ComponentContainer` div + custom `css` via manifest `sap.ui5.resources.css`. No FLP sandbox.
- **Draft lifecycle (V4 freestyle):** create via list-binding `create({...})` → edit items via the table binding's `create()` → `ExpenseService.draftActivate` to save → `submitClaim`. `submitClaim` validates the **active** entity, so submit = activate-then-submit; on a 422 the draft is already active, so rebind to `IsActiveEntity=true` and let the user Edit→fix→resubmit. Don't chain two bound actions on an operation-returned context ("nested deferred operation") — re-resolve a fresh canonical context between them.
- **V4 + formatter on a boolean/non-string control prop** (e.g. `visible`, `editable`) needs `targetType: 'any'` in the binding, else V4 coerces the raw `Edm.String` and logs `"X is not a valid boolean"`. Prefer driving such flags from a plain JSON `ui` model.
- Receipt upload = manual media `PUT expense/MyClaimItems(ID=..,IsActiveEntity=..)/receipt` with an `x-csrf-token` (fetch `HEAD` first). Path is **relative** (no leading slash) for the Work Zone managed approuter.
- Bound-action key (backend): `req.params[0]` is `{ID}` for draft entities, a raw scalar for non-draft — normalise via `idOf()`.
- VAT/totals computed in `before('SAVE')` (draft requirement), NOT per-item handlers. UI sends only `country`, `claimPeriod`, item/mileage inputs — all money math is server-side.
- After any change: `npm test` (113) and `npx cds compile srv db -s all --to edmx-v4 -o /tmp/x` (warning-free; `reject()` base-class note is pre-existing).

## Mock logins (dev — all have Employee+Approver+Admin except clerk/priya)
**The username is the FULL EMAIL** (`…@bluestonex.com`), not the shorthand — logging in with just `sab` authenticates as a **role-less** user and every `/expense` call 403s. Format below is `username` / `password`:
- `sabarinathan.chandrasekar@bluestonex.com` / `sab`
- `manager@bluestonex.com` / `mgr` (UK L1)
- `Dan.Barton@bluestonex.com` / `dan` (UK L2)
- `yuvaraj.kumar@bluestonex.com` / `yuvaraj` (IN L1)
- `clerk@bluestonex.com` / `clerk` (employee-only)
- `priya.sharma@bluestonex.com` / `priya` (India employee)

## Repo
https://github.com/SureshRajarathinam/Bluestonex-Expense-V1

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
