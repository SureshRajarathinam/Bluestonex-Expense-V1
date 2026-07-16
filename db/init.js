'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  Dev / test-only employee seed for the USERS_MASTER stand-in.
//
//  In PRODUCTION the app reads the LIVE org `USERS_MASTER` table in another HDI
//  container via a cross-container synonym (see db/external/README.md), so nothing
//  here runs on HANA.
//
//  In dev/test (file-based / in-memory SQLite) the external table does not exist,
//  and `ext.UsersMaster` is @cds.persistence.exists — so CAP does NOT create it.
//  We therefore create a local USERS_MASTER stand-in via raw DDL and seed a small,
//  real subset of the master. Dan Barton and Suresh match the mock logins
//  case-insensitively, so employee auto-population works locally.
//
//  Columns mirror ext.UsersMaster exactly (db/external/users-master.cds).
// ─────────────────────────────────────────────────────────────────────────────

const cds = require('@sap/cds');

// Only the columns that exist on ext.UsersMaster (no Pic/Target*/Bonus/Pension).
const SAMPLE_USERS = [
  { ID: 3,   UserID: 'S000000001', OrgID: 'BSX', FName: 'Dan',          LName: 'Barton',       Email: 'dan.barton@bluestonex.com',           Mobile: null, EmpID: 'S000000001', UserTypeKey: 'S', BaseSiteKey: 'UKOSW', ManagerID: 'S000000001', IsActive: 'Y' },
  { ID: 4,   UserID: 'S000000011', OrgID: 'BSX', FName: 'Carol',        LName: 'Barton',       Email: 'carol.barton@bluestonex.com',         Mobile: null, EmpID: 'S000000011', UserTypeKey: 'S', BaseSiteKey: 'UKOSW', ManagerID: 'S000000001', IsActive: 'Y' },
  { ID: 5,   UserID: 'S000000002', OrgID: 'BSX', FName: 'Feroz',        LName: 'Khan',         Email: 'feroz.khan@bluestonex.com',           Mobile: null, EmpID: 'S000000002', UserTypeKey: 'S', BaseSiteKey: 'UKOSW', ManagerID: 'S000000002', IsActive: 'Y' },
  { ID: 8,   UserID: 'S000000009', OrgID: 'BSX', FName: 'Vikash',       LName: 'Kumar',        Email: 'vikash.kumar@bluestonex.com',         Mobile: null, EmpID: 'S000000009', UserTypeKey: 'S', BaseSiteKey: 'UKOSW', ManagerID: 'S000000001', IsActive: 'Y' },
  { ID: 9,   UserID: 'S000000014', OrgID: 'BSX', FName: 'Bala',         LName: 'subramanian',  Email: 'bala.subramanian@bluestonex.com',     Mobile: null, EmpID: 'S000000014', UserTypeKey: 'S', BaseSiteKey: 'INAUG', ManagerID: 'S000000008', IsActive: 'Y' },
  { ID: 17,  UserID: 'S000000020', OrgID: 'BSX', FName: 'Dave',         LName: 'Williams',     Email: 'dave.williams@bluestonex.com',        Mobile: null, EmpID: 'S000000020', UserTypeKey: 'S', BaseSiteKey: 'UKOSW', ManagerID: 'S000000001', IsActive: 'Y' },
  { ID: 20,  UserID: 'S000000032', OrgID: 'BSX', FName: 'Ramesh',       LName: 'Gubba',        Email: 'ramesh.gubba@bluestonex.com',         Mobile: null, EmpID: 'S000000032', UserTypeKey: 'S', BaseSiteKey: 'UKOSW', ManagerID: 'S000000002', IsActive: 'N' },
  { ID: 21,  UserID: 'S000000005', OrgID: 'BSX', FName: 'Kyle',         LName: 'Barnfield',    Email: 'kyle.barnfield@bluestonex.com',       Mobile: null, EmpID: 'S000000005', UserTypeKey: 'S', BaseSiteKey: 'UKOSW', ManagerID: 'S000000002', IsActive: 'Y' },
  { ID: 22,  UserID: 'S000000008', OrgID: 'BSX', FName: 'Sabarinathan', LName: 'Chandrasekar', Email: 'sabari.chandrasekar@bluestonex.com',  Mobile: null, EmpID: 'S000000008', UserTypeKey: 'S', BaseSiteKey: 'UKOSW', ManagerID: 'S000000001', IsActive: 'Y' },
  { ID: 25,  UserID: 'S000000015', OrgID: 'BSX', FName: 'Nick',         LName: 'Sullivan',     Email: 'nick.sullivan@bluestonex.com',        Mobile: null, EmpID: 'S000000015', UserTypeKey: 'S', BaseSiteKey: 'UKOSW', ManagerID: 'S000000001', IsActive: 'N' },
  { ID: 46,  UserID: 'S000000035', OrgID: 'BSX', FName: 'Yuvaraj',      LName: 'Kumar',        Email: 'Yuvaraj.kumar@bluestonex.com',        Mobile: null, EmpID: 'S000000035', UserTypeKey: 'S', BaseSiteKey: 'UKOSW', ManagerID: 'S000000008', IsActive: 'Y' },
  { ID: 116, UserID: '41BF363FB0AD3100F000000246A75000', OrgID: 'BSX', FName: 'Suresh', LName: 'Rajarathinam', Email: 'Suresh.Rajarathinam@Bluestonex.com', Mobile: null, EmpID: '41BF363FB0AD3100F000000246A75000', UserTypeKey: 'S', BaseSiteKey: 'INAUG', ManagerID: 'S000000008', IsActive: 'Y' }
];

// Raw DDL for the local stand-in (CAP skips it because ext.UsersMaster is
// @cds.persistence.exists). NOTE: SQLite ignores @cds.persistence.name and uses
// the default physical name `ext_UsersMaster` (namespace_Entity) — that's the
// name CAP's own INSERT/SELECT target, so the table must be created under it.
// (On HANA @cds.persistence.name → the USERS_MASTER synonym; init.js never runs
// there.) Column names/order mirror ext.UsersMaster.
const CREATE_USERS_MASTER = `CREATE TABLE IF NOT EXISTS ext_UsersMaster (
  ID BIGINT, UserID NVARCHAR(50), OrgID NVARCHAR(10), FName NVARCHAR(50),
  LName NVARCHAR(50), Email NVARCHAR(100), Mobile NVARCHAR(15), EmpID NVARCHAR(50),
  UserTypeKey NVARCHAR(50), BaseSiteKey NVARCHAR(50), ManagerID NVARCHAR(50),
  IsActive NVARCHAR(1)
)`;

module.exports = async (db) => {
  // Never touch a production/HANA database (init.js won't run under the HDI
  // deployer, but this is belt-and-suspenders).
  if (cds.env.profiles && cds.env.profiles.includes('production')) return;

  const { UsersMaster } = db.entities('ext');
  await db.run(CREATE_USERS_MASTER);
  await db.run(INSERT.into(UsersMaster).entries(SAMPLE_USERS));
};
