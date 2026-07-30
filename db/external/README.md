# Reusing the classic `USERS_MASTER` employee master (cross-container)

**Status: STAGED — prepared, not deployed.** Nothing here is active yet. Local dev
and the test suite are unchanged (they keep the seeded `EXP_EMPLOYEES` on SQLite).
Activating this requires a **grantor DB user** and an **approved HANA deploy** — both
gated.

## Goal
Read employee identity from the existing **`USERS_MASTER`** table that lives in a
**different HDI container** (`hdi_bsx-org-apps-db`, runtime schema
`DC573873CB504DC1BAE855BD389B1072`) instead of maintaining our own seed — in
**production only**. Dev/test stay on the seed (hybrid).

## Field mapping (USERS_MASTER → app identity)
| App identity | USERS_MASTER | Notes |
|---|---|---|
| `email` | `Email` | join key to `$user`; **case-insensitive** |
| `fullName` | `FName` + `LName` | concatenated |
| `employeeNumber` | `EmpID` | |
| `site` | `BaseSiteKey` | UKOSW / INAUG / PLRMT / Apphaus |
| `active` | `IsActive` | `'N'` → inactive |
| (external id) | `ID` | BIGINT — **not** our UUID FK |

`department`, `country`, `financeEmail`, and our `role` do **not** exist in
`USERS_MASTER`. The **Spend-by-team** dashboard card was removed because it depended
on `department`.

## Files in this change
- `db/external/users-master.cds` — external entity `ext.UsersMaster`
  (`@cds.persistence.exists`, `@cds.persistence.name: 'USERS_MASTER'`). Inert on
  SQLite (never queried in dev/test).
- `db/external/USERS_MASTER.hdbsynonym` — synonym → the external table. **Staged here
  (NOT in `db/src/`)** so the HDI deployer does not process it while USERS_MASTER is
  inactive — otherwise deploy fails with "service bsx-org-apps-db not found". Move it
  into `db/src/` only when activating (step 3 below).
- `db/external/USERS_MASTER.hdbgrants` — cross-container SELECT grant. Same staging rule
  as the synonym: keep out of `db/src/` until the `bsx-org-apps-db` container is bound.
- `srv/lib/employee-source.js` — the single cut-over point. `findByEmail(email)`
  returns normalised identity; reads `ext.UsersMaster` when
  `EMPLOYEE_SOURCE=USERS_MASTER`, else `EXP_EMPLOYEES`.
- `mta.yaml` — a commented, staged `bsx-org-apps-db` resource.

## Activation steps (when the grant + deploy are approved)
1. **Confirm the grantor.** The technical user of `hdi_bsx-org-apps-db` (or a DBA)
   must own `USERS_MASTER` or hold `SELECT ... WITH GRANT OPTION`.
2. **Move the HDI files into the deploy path + fill the placeholders.** Move
   `db/external/USERS_MASTER.hdb{synonym,grants}` into `db/src/` so the HDI deployer
   picks them up, then set the real provider schema (or switch to a granted **role**
   instead of the schema GUID, which is more portable across environments).
3. **Wire the resource.** In `mta.yaml`, uncomment `bsx-org-apps-db`, set its real
   `service-name`, and add it to the `requires:` of both `expense-management-srv`
   and `expense-management-db-deployer`.
4. **Deploy** (gated): `mbt build && cf deploy mta_archives/*.mtar`.
5. **Verify read access** in the HDI container:
   ```sql
   SELECT COUNT(*) FROM "USERS_MASTER";   -- via the deployed synonym
   ```
6. **Flip the source:** set `EMPLOYEE_SOURCE=USERS_MASTER` on `expense-management-srv`
   (`cf set-env expense-management-srv EMPLOYEE_SOURCE USERS_MASTER && cf restage …`).

### DBA alternative to `.hdbgrants` (manual object grant)
```sql
-- Run as the USERS_MASTER owner in hdi_bsx-org-apps-db.
GRANT SELECT ON "DC573873CB504DC1BAE855BD389B1072"."USERS_MASTER"
  TO "<expense-management-db#OO>";   -- object owner of our container
GRANT SELECT ON "DC573873CB504DC1BAE855BD389B1072"."USERS_MASTER"
  TO "<expense-management-db runtime user>";
```

## Deferred (deploy-time) decision — the claim↔employee FK
`claim.employee` is a **UUID FK to `EXP_EMPLOYEES`**; `USERS_MASTER.ID` is a BIGINT in
a different identity space. So the resolver is **identity/display only** and is **not**
wired into the claim write-path. Before production cut-over, pick one:
- **(A) Mirror** — keep a thin `EXP_EMPLOYEES` row per active user, synced from
  `USERS_MASTER` by email (keeps the existing FK untouched); **or**
- **(B) Denormalise** — store the employee email/identity on the claim and drop the
  association, resolving display data from `USERS_MASTER` at read time.

Recommendation: **(A) Mirror** — smallest blast radius, keeps every existing query and
the association working.
