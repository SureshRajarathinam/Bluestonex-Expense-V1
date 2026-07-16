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
- `db/src/USERS_MASTER.hdbsynonym` — synonym `USERS_MASTER_SYN` → the org `DC573….USERS_MASTER`
  (target schema hardcoded).
- `db/src/EXT_USERSMASTER.hdbview` — wrapper view: re-aliases the org table's quoted mixed-case
  columns (`"Email"`,`"FName"`,…) to the UPPERCASE names CAP generates (`EMAIL`,`FNAME`,…). CAP's
  `ext.UsersMaster` resolves to this view (physical name `EXT_USERSMASTER`), NOT to the synonym.
- `db/src/USERS_MASTER.hdbgrants` — requests the org container role via
  `container_roles: ["ExpenseAppRole"]` for `object_owner` + `application_user`.
- `db/src/.hdiconfig` + `.hdinamespace` — needed so the synonym/view/grants at `db/src/` compile
  (CAP's own generated config sits one level down in `db/src/gen/`).
- `mta.yaml` — `bsx-org-apps-db` (`existing-service` → `hdi_bsx-org-apps-db`) bound to srv +
  db-deployer as the grantor for the container-role grant.
- `db/init.js` — dev/test-only local stand-in create + seed.

> **How access works (current design).** A direct object grant via `.hdbgrants` is impossible here —
> HANA rejects object privileges from an HDI-container grantor
> (`object privileges are not supported in case of an HDI container service binding`). So the org
> team owns a **container role `ExpenseAppRole`** (in `hdi_bsx-org-apps-db`) that grants `SELECT` on
> `USERS_MASTER`, and we consume it via `container_roles` in `db/src/USERS_MASTER.hdbgrants`.
>
> ⚠ **The role MUST grant `SELECT` WITH GRANT OPTION.** Our wrapper view `EXT_USERSMASTER` is owned
> by our container's `#OO`; for the app's runtime user to read *through* that view (HANA definer
> rights), `#OO` must hold the underlying `SELECT` as **grantable**. Without grant option the build
> still succeeds but every employee read fails at runtime with `insufficient privilege` — 500 on
> Employees / ClaimHistory / Approvals / dashboardStats (whoami silently falls back via try/catch).
> In the org's `ExpenseAppRole.hdbrole`: `"privileges_with_grant_option": ["SELECT"]` on
> `USERS_MASTER`.

## Activation — org exposes `ExpenseAppRole` (with grant option), then we deploy
1. **Org side (owner of `hdi_bsx-org-apps-db`):** in `ExpenseAppRole.hdbrole`, grant `SELECT` on
   `USERS_MASTER` **WITH GRANT OPTION**, then redeploy that container:
   ```json
   "object_privileges": [
     { "schema_name": "DC573873CB504DC1BAE855BD389B1072", "object_name": "USERS_MASTER",
       "privileges_with_grant_option": ["SELECT"] } ]
   ```
2. **Our side:** `mbt build && cf deploy mta_archives/*.mtar`. HDI applies the role
   (`container_roles: ["ExpenseAppRole"]`), builds the synonym `USERS_MASTER_SYN` + wrapper view
   `EXT_USERSMASTER`, and — because the role is now grantable — grants the container access role
   SELECT on the view so the runtime user can read it.
3. **Verify** as the app runtime user, in HANA SQL:
   ```sql
   SELECT COUNT(*) FROM "EXT_USERSMASTER";   -- rows, no "insufficient privilege"
   ```
   Then open the apps: dashboard loads, Approvals/History show employee names, whoami greets by name.

No manual per-user grant and no runtime flag: if the role or the `expense-management-db` container is
ever recreated, just redeploy — the `.hdbgrants` re-requests `ExpenseAppRole` automatically.
