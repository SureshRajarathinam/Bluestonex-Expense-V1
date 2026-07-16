# Reusing the classic `USERS_MASTER` employee master (cross-container)

**Status: WIRED, not yet deployable.** The HDI synonym + grants are in `db/src/` and
the `bsx-org-apps-db` resource is wired in `mta.yaml`, but the deploy will FAIL until
(a) the real `service-name` is filled in `mta.yaml` and (b) a **grantor** can grant
`SELECT` on `USERS_MASTER` to this container. Prepared on branch `feat/users-master`;
keep it off any deployed branch until (a)+(b) are ready. Dev/test are unaffected
(they use a local seeded stand-in — see below).

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
- `db/src/USERS_MASTER.hdbgrants` — cross-container `SELECT` grant for our container's
  `object_owner` (deploy-time) + `application_user` (runtime), via the `bsx-org-apps-db`
  grantor service.
- `mta.yaml` — `bsx-org-apps-db` resource (`existing-service`) wired into the `requires:`
  of both `expense-management-srv` and `expense-management-db-deployer`.
- `db/init.js` — dev/test-only local stand-in create + seed.

## Activation (gated — needs a DBA / BTP admin)
1. **Provide the grantor.** A service bound as `bsx-org-apps-db` whose user holds
   `SELECT … WITH GRANT OPTION` on `USERS_MASTER` (so the HDI deployer can apply
   `USERS_MASTER.hdbgrants`). Typically a service instance / SBSS on the org container.
2. **Set the service name.** Replace `<SERVICE_NAME>` in `mta.yaml` (`bsx-org-apps-db`
   → `service-name`) with the real instance, and ensure it is **shared into this space**.
3. **Deploy** (gated): `mbt build && cf deploy mta_archives/*.mtar`. This also drops the
   old `EXP_EMPLOYEES` table (auto_undeploy) — expected.
4. **Verify** read access in our container:
   ```sql
   SELECT COUNT(*) FROM "USERS_MASTER";   -- via the deployed synonym
   ```
   Then open the app: the whoami greeting + claim `employeeName` resolve from the live
   table. There is **no runtime flag** to flip — the app reads `USERS_MASTER` as soon
   as the synonym + grant are in place.

### DBA alternative to the grantor service (manual object grant)
Fragile (HDI can recreate the technical users on redeploy), but quick:
```sql
-- Run as the USERS_MASTER owner in hdi_bsx-org-apps-db.
GRANT SELECT ON "DC573873CB504DC1BAE855BD389B1072"."USERS_MASTER"
  TO "<expense-management-db#OO>" WITH GRANT OPTION;
GRANT SELECT ON "DC573873CB504DC1BAE855BD389B1072"."USERS_MASTER"
  TO "<expense-management-db runtime user>";
```
Prefer the grantor service (`.hdbgrants`) for anything long-lived.
