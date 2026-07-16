# Reusing the classic `USERS_MASTER` employee master (cross-container)

**Status: WIRED. Deploys once the manual grant is in place.** The HDI synonym is in `db/src/`
and the `bsx-org-apps-db` resource is wired in `mta.yaml`. Production reads of `USERS_MASTER`
work as soon as the `USERS_MASTER` owner runs the one-time `SELECT` grant (see "Activation"
below). There is **no `.hdbgrants`** — HDI cannot apply object privileges from an HDI-container
grantor. Dev/test are unaffected (they use a local seeded stand-in — see below).

## Design
`USERS_MASTER` is the **sole** employee master for the app (the old `EXP_EMPLOYEES`
mirror was removed). One entity, `ext.UsersMaster` (`db/external/users-master.cds`,
`@cds.persistence.exists` + `@cds.persistence.name: 'USERS_MASTER'`), is used everywhere:
- **Production (HANA):** the cross-container synonym resolves `USERS_MASTER` to the
  org container `hdi_bsx-org-apps-db` (runtime schema `DC573873CB504DC1BAE855BD389B1072`).
  `exists` means the deployer never issues CREATE TABLE, so it binds to the synonym.
- **Dev/test (SQLite):** the external table doesn't exist, so `db/init.js` creates a
  local stand-in and seeds it. NOTE: SQLite ignores `@cds.persistence.name`, so the
  physical table is `ext_UsersMaster` — that's the name `init.js` creates.
- **Claim link:** `CLAIMS.employee : Association to ext.UsersMaster`; `employee_ID`
  stores `USERS_MASTER.ID` (BIGINT). CAP emits no cross-container FK constraint (fine
  — joins resolve through the synonym in prod / the local table in dev).

## Field mapping (USERS_MASTER → app identity)
| App identity | USERS_MASTER | Notes |
|---|---|---|
| `email` | `Email` | join key to `$user`; **case-insensitive** |
| `fullName` | `FName` + `LName` | concatenated |
| `employeeNumber` | `EmpID` | |
| `site` | `BaseSiteKey` | UKOSW / INAUG / PLRMT / Apphaus |
| `active` | `IsActive` | `'N'` → inactive |
| (id / FK value) | `ID` | BIGINT — stored as `CLAIMS.employee_ID` |

`department`, `country`, `financeEmail`, and `role` do **not** exist in `USERS_MASTER`.
Country is derived from `BaseSiteKey` (UK* → UK, IN* → IN).

## Files
- `db/external/users-master.cds` — the `ext.UsersMaster` entity (the model; stays here).
- `db/src/USERS_MASTER.hdbsynonym` — synonym → the external table (in the deploy path).
  The target schema (`DC573…`) is **hardcoded**, so the synonym resolves WITHOUT a grantor
  binding; it just needs the runtime/`#OO` users to hold `SELECT` on the target (see below).
- `mta.yaml` — `bsx-org-apps-db` resource (`existing-service`) still wired into `requires:`
  of both modules (now vestigial — harmless; drop later if desired).
- `db/init.js` — dev/test-only local stand-in create + seed.

> **Why there is NO `.hdbgrants`.** We originally shipped a `USERS_MASTER.hdbgrants` granting
> `SELECT` via the `hdi_bsx-org-apps-db` grantor service. HANA rejects it:
> `object privileges are not supported in case of an HDI container service binding`. `.hdbgrants`
> can grant *object* privileges only from a plain user/securestore grantor — **not** from another
> **HDI container** (which the org's `hdi_bsx-org-apps-db` is; that only exposes container *roles*,
> which we don't own). So the grant is done **manually, once**, by the `USERS_MASTER` owner. The
> grants file was removed.

## Activation — manual grant (gated: run by the `USERS_MASTER` owner), then deploy
The grant MUST land **before** the deploy, because the CAP-generated views (e.g.
`ApprovalService.Employees.hdbview`) are built by our container's object owner (`#OO`) on top of
the synonym → `DC573….USERS_MASTER`; `#OO` needs `SELECT … WITH GRANT OPTION` to create them.

1. **Run the grant** as the `USERS_MASTER` owner (the `DC573…` schema owner) in the org
   container's SQL console. User names below come from the live `VCAP_SERVICES` of
   `expense-management-db`:
   ```sql
   -- object owner: needed at DEPLOY time to build the views on the synonym + cascade to the
   -- container access role (so the runtime user inherits SELECT automatically).
   GRANT SELECT ON "DC573873CB504DC1BAE855BD389B1072"."USERS_MASTER"
     TO "6536919E64B54B90AF8DC846613EF484#OO" WITH GRANT OPTION;

   -- runtime user: explicit belt-and-suspenders for the app's queries.
   GRANT SELECT ON "DC573873CB504DC1BAE855BD389B1072"."USERS_MASTER"
     TO "6536919E64B54B90AF8DC846613EF484_C0G93XPG403KYIZMKX0MCFQ70_RT";
   ```
   ⚠ These names are tied to the CURRENT `expense-management-db` instance. If that HDI
   container is ever deleted + recreated, the `#OO`/`_RT` names change — re-read them from
   `cf env expense-management-srv` (the `hana` binding for `expense-management-db`) and re-grant.
2. **Deploy:** `mbt build && cf deploy mta_archives/*.mtar`. Also drops the old `EXP_EMPLOYEES`
   table (auto_undeploy) — expected.
3. **Verify** read access in our container:
   ```sql
   SELECT COUNT(*) FROM "USERS_MASTER";   -- via the deployed synonym
   ```
   Then open the app: the whoami greeting + claim `employeeName` resolve from the live table.
   There is **no runtime flag** — the app reads `USERS_MASTER` as soon as the synonym + grant
   are in place.

### Longer-lived alternative (avoids re-granting on container recreate)
Ask the org team that owns `hdi_bsx-org-apps-db` to expose a **container role** granting `SELECT`
on `USERS_MASTER` (a `.hdbrole` in THEIR container). We then consume it from a `.hdbgrants` via
`container_roles` (not `object_privileges`) — the only form HDI allows from an HDI-container
grantor. Requires their cooperation + deploy, so the manual grant above is the pragmatic default.
