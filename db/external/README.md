# Reusing the classic `USERS_MASTER` employee master (cross-container)

**Status: LIVE — no owner action required.** The app reads the org `USERS_MASTER`
(in HDI container `hdi_bsx-org-apps-db`) through the cross-container **synonym**
`USERS_MASTER_SYN` using **native SQL as the runtime user**, which holds `SELECT` via
the org's container role `ExpenseAppRole` (granted to `application_user` in
`db/src/USERS_MASTER.hdbgrants`). A synonym is transparent — a plain role-granted
`SELECT` is enough, so **no `WITH GRANT OPTION` and no owner change is needed**.
Dev/test use a local seeded stand-in (see below).

> **Why native SQL, not CAP CQL (the important bit).** CAP CQL against `ext.UsersMaster`
> on HANA targets the `#OO`-owned wrapper view `EXT_USERSMASTER`. Reading a view owned by
> the container's technical user requires that owner to hold the underlying `SELECT`
> **WITH GRANT OPTION** (HANA definer rights) — the org role does not grant that, so every
> such read 500s with `insufficient privilege`. The fix (**"Plan B"**) is to never let a
> query traverse the employee association or read `ext.UsersMaster` via CAP on HANA:
> the runtime user reads the **synonym directly** through `srv/lib/users-master.js`
> (native quoted SQL), and claimant identity shown in lists is **denormalized onto CLAIMS**.

## Design
`USERS_MASTER` is the **sole** employee master (the old `EXP_EMPLOYEES` mirror was removed).
The entity `ext.UsersMaster` (`db/external/users-master.cds`, `@cds.persistence.exists`) models
it, but **all HANA reads go through `srv/lib/users-master.js`**, never CAP CQL:
- **`srv/lib/users-master.js`** — the single employee-read point. On HANA: native
  `SELECT "ID","FName",… FROM "USERS_MASTER_SYN"` (quoted so HANA preserves the mixed-case
  column names), run as the runtime user. On SQLite: ordinary CQL on the local stand-in.
  Result rows are keyed identically on both DBs (`ID`, `FName`, `Email`, `EmpID`, …).
- **Denormalized claimant identity on CLAIMS** — `employeeName` / `employeeNumber` /
  `employeeEmail` are real columns, set from the master in `expense-service before('SAVE')`.
  The list screens (`Approvals`, `ClaimHistory`, `MyClaims`) display + `$filter`-search these
  columns with **no join to the master on read**. Older rows (pre-denormalization) are filled
  display-only by an `after('READ')` batch backfill; new rows never trigger an external read.
- **`Employees`** (the Admin approver picker) is served by an `on('READ')` handler that calls
  `usersMaster.listAll()` — so no DB query targets the wrapper view.
- **Claim link:** `CLAIMS.employee : Association to ext.UsersMaster`; `employee_ID` stores
  `USERS_MASTER.ID` (BIGINT). The association is **never traversed in a query** at runtime; it
  exists only so `cds build` resolves the FK column + (on HANA) the association's target object.

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
- `db/external/users-master.cds` — the `ext.UsersMaster` entity (the model).
- `srv/lib/users-master.js` — **the only HANA reader of the master** (native SQL on the synonym).
- `db/src/USERS_MASTER.hdbsynonym` — synonym `USERS_MASTER_SYN` → the org `DC573….USERS_MASTER`.
- `db/src/USERS_MASTER.hdbgrants` — requests `ExpenseAppRole` via `container_roles` for
  `object_owner` **and `application_user`** (the latter is what lets the runtime user read the synonym).
- `db/src/EXT_USERSMASTER.hdbview` — **retained but no longer read at runtime.** It only exists so the
  `CLAIMS.employee` association has a resolvable target object at deploy time. Because nothing queries
  through it, its `WITH GRANT OPTION` requirement is moot — the runtime never reads it.
- `db/src/.hdiconfig` + `.hdinamespace` — so the synonym/view/grants under `db/src/` compile.
- `mta.yaml` — `bsx-org-apps-db` (`existing-service` → `hdi_bsx-org-apps-db`) bound to srv + db-deployer.
- `db/init.js` — dev/test-only local stand-in create + seed.

## Deploy / redeploy
No owner action, no grant option. Just:
```bash
mbt build && cf deploy mta_archives/*.mtar
```
HDI applies `ExpenseAppRole` (so the runtime user can `SELECT` the synonym), (re)creates the synonym,
and adds the denormalized `CLAIMS.employee*` columns. On first save each claim is stamped with the
claimant's name/number/email; existing in-flight claims get their name filled on read via the backfill.

## Verify (as the app runtime user, HANA SQL)
```sql
SELECT COUNT(*) FROM "USERS_MASTER_SYN";   -- returns rows, no "insufficient privilege"
```
Then the apps: Approval dashboard + queue load (no "Internal Server Error"), History/Approvals show
employee names and search by name works, the Workflow approver picker populates, and My Expenses lists.

## Historical note (Plan A — not used)
The earlier design read `ext.UsersMaster` via CAP CQL through the `EXT_USERSMASTER` wrapper view. That
required the org owner to grant `SELECT ... WITH GRANT OPTION` on `USERS_MASTER` to `ExpenseAppRole`
(HANA definer rights). To remove that owner dependency we switched to native-SQL-on-synonym +
denormalization (this document). If the wrapper-view route is ever revived, the owner must add
`"privileges_with_grant_option": ["SELECT"]` on `USERS_MASTER` to `ExpenseAppRole`.
