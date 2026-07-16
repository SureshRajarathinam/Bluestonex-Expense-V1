// ─────────────────────────────────────────────────────────────────────────────
//  External org master: USERS_MASTER (classic BSX org-apps HDI container)
//
//  This is a READ-ONLY view of the existing `USERS_MASTER` table that lives in a
//  DIFFERENT HDI container (`hdi_bsx-org-apps-db`). It is reached at runtime via a
//  cross-container synonym + grants (see db/external/README.md), NOT deployed by us.
//
//  This is now the SOLE employee master for the app (the old EXP_EMPLOYEES mirror
//  was removed). CLAIMS.employee associates to it and all identity/name resolution
//  reads it.
//
//  @cds.persistence.exists  → the deployer must NOT issue CREATE TABLE for it
//                             (the table already exists in the other container; a
//                             cross-container synonym points at it in production).
//  @cds.persistence.name    → bind to the physical/synonym name `USERS_MASTER`.
//
//  Dev/test run on SQLite where the external table does not exist, so `exists`
//  suppresses table creation. db/init.js creates a local USERS_MASTER stand-in
//  (raw DDL) and seeds it — see db/init.js. Production reaches the live org table
//  via the synonym + cross-container grant (see db/external/README.md).
// ─────────────────────────────────────────────────────────────────────────────
namespace ext;

@cds.persistence.exists
@cds.persistence.name: 'USERS_MASTER'
entity UsersMaster {
  key ID          : Integer64;      // BIGINT
      UserID      : String(50);
      OrgID       : String(10);
      FName       : String(50);
      LName       : String(50);
      Email       : String(100);    // join key to $user (case-insensitive)
      Mobile      : String(15);
      EmpID       : String(50);
      UserTypeKey : String(50);
      BaseSiteKey : String(50);     // UKOSW | INAUG | PLRMT | Apphaus (site, not dept)
      ManagerID   : String(50);
      IsActive    : String(1);      // 'Y' | 'N'
}
