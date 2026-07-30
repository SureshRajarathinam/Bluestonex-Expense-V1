// ─────────────────────────────────────────────────────────────────────────────
//  External org master: USERS_MASTER (classic BSX org-apps HDI container)
//
//  This is a READ-ONLY view of the existing `USERS_MASTER` table that lives in a
//  DIFFERENT HDI container (`hdi_bsx-org-apps-db`). It is reached at runtime via a
//  cross-container synonym + grants (see db/external/README.md), NOT deployed by us.
//
//  @cds.persistence.exists  → the deployer must NOT issue CREATE TABLE for it
//                             (the table already exists in the other container).
//  @cds.persistence.name    → bind to the physical/synonym name `USERS_MASTER`.
//
//  HYBRID (per decision): this is only consulted in PRODUCTION (HANA). Local dev and
//  the test suite run on in-memory SQLite where this table does not exist — nothing
//  queries it there, so the seeded EXP_EMPLOYEES remains the dev/test source.
//  The runtime cut-over (EMPLOYEE_SOURCE=USERS_MASTER) is a post-deploy step.
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
