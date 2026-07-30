'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  Dev / test-only employee seed  (Model B: manual HANA import in production)
//
//  EXP_EMPLOYEES mirrors USERS_MASTER. In PRODUCTION the table deploys EMPTY and
//  is populated by importing Master_User_BSX.csv directly into HANA (Database
//  Explorer → Import Data) — so there is NO EXP-EMPLOYEES.csv in db/data and
//  nothing is shipped as .hdbtabledata.
//
//  CAP runs db/init.js only for the file-based SQLite deploy (local `cds watch`
//  + the test suite) — never under the HANA HDI deployer — so these sample rows
//  exist only in dev/test. They are a small, real subset of the master (no
//  photos). Dan Barton and Suresh match the mock logins case-insensitively, so
//  employee auto-population works locally; the app tolerates a no-match for the
//  rest (ownership is by createdBy).
// ─────────────────────────────────────────────────────────────────────────────

const cds = require('@sap/cds');

const SAMPLE_EMPLOYEES = [
  { ID: 3,   UserID: 'S000000001', OrgID: 'BSX', FName: 'Dan',          LName: 'Barton',       Email: 'dan.barton@bluestonex.com',           EmpID: 'S000000001', UserTypeKey: 'S', BaseSiteKey: 'UKOSW', ManagerID: 'S000000001', IsActive: 'Y', TargetUtilization: 10, TargetHrsPerWeek: '40:00', BonusPercent: 5, PensionRate: 3 },
  { ID: 4,   UserID: 'S000000011', OrgID: 'BSX', FName: 'Carol',        LName: 'Barton',       Email: 'carol.barton@bluestonex.com',         EmpID: 'S000000011', UserTypeKey: 'S', BaseSiteKey: 'UKOSW', ManagerID: 'S000000001', IsActive: 'Y', TargetUtilization: 0,  TargetHrsPerWeek: '40:00', BonusPercent: 5, PensionRate: 3 },
  { ID: 5,   UserID: 'S000000002', OrgID: 'BSX', FName: 'Feroz',        LName: 'Khan',         Email: 'feroz.khan@bluestonex.com',           EmpID: 'S000000002', UserTypeKey: 'S', BaseSiteKey: 'UKOSW', ManagerID: 'S000000002', IsActive: 'Y', TargetUtilization: 0,  TargetHrsPerWeek: '40:00', BonusPercent: 5, PensionRate: 3 },
  { ID: 8,   UserID: 'S000000009', OrgID: 'BSX', FName: 'Vikash',       LName: 'Kumar',        Email: 'vikash.kumar@bluestonex.com',         EmpID: 'S000000009', UserTypeKey: 'S', BaseSiteKey: 'UKOSW', ManagerID: 'S000000001', IsActive: 'Y', TargetUtilization: 50, TargetHrsPerWeek: '40:00', BonusPercent: 3, PensionRate: 3 },
  { ID: 9,   UserID: 'S000000014', OrgID: 'BSX', FName: 'Bala',         LName: 'subramanian',  Email: 'bala.subramanian@bluestonex.com',     EmpID: 'S000000014', UserTypeKey: 'S', BaseSiteKey: 'INAUG', ManagerID: 'S000000008', IsActive: 'Y', TargetUtilization: 75, TargetHrsPerWeek: '40:00', BonusPercent: 3, PensionRate: 3 },
  { ID: 17,  UserID: 'S000000020', OrgID: 'BSX', FName: 'Dave',         LName: 'Williams',     Email: 'dave.williams@bluestonex.com',        EmpID: 'S000000020', UserTypeKey: 'S', BaseSiteKey: 'UKOSW', ManagerID: 'S000000001', IsActive: 'Y', TargetUtilization: 75, TargetHrsPerWeek: '40:00', BonusPercent: 3, PensionRate: 3 },
  { ID: 20,  UserID: 'S000000032', OrgID: 'BSX', FName: 'Ramesh',       LName: 'Gubba',        Email: 'ramesh.gubba@bluestonex.com',         EmpID: 'S000000032', UserTypeKey: 'S', BaseSiteKey: 'UKOSW', ManagerID: 'S000000002', IsActive: 'N', TargetUtilization: 50, TargetHrsPerWeek: '40:00', BonusPercent: 5, PensionRate: 3 },
  { ID: 21,  UserID: 'S000000005', OrgID: 'BSX', FName: 'Kyle',         LName: 'Barnfield',    Email: 'kyle.barnfield@bluestonex.com',       EmpID: 'S000000005', UserTypeKey: 'S', BaseSiteKey: 'UKOSW', ManagerID: 'S000000002', IsActive: 'Y', TargetUtilization: 50, TargetHrsPerWeek: '40:00', BonusPercent: 5, PensionRate: 3 },
  { ID: 22,  UserID: 'S000000008', OrgID: 'BSX', FName: 'Sabarinathan', LName: 'Chandrasekar', Email: 'sabari.chandrasekar@bluestonex.com',  EmpID: 'S000000008', UserTypeKey: 'S', BaseSiteKey: 'UKOSW', ManagerID: 'S000000001', IsActive: 'Y', TargetUtilization: 75, TargetHrsPerWeek: '40:00', BonusPercent: 3, PensionRate: 3 },
  { ID: 25,  UserID: 'S000000015', OrgID: 'BSX', FName: 'Nick',         LName: 'Sullivan',     Email: 'nick.sullivan@bluestonex.com',        EmpID: 'S000000015', UserTypeKey: 'S', BaseSiteKey: 'UKOSW', ManagerID: 'S000000001', IsActive: 'N', TargetUtilization: 25, TargetHrsPerWeek: '32:00', BonusPercent: 5, PensionRate: 3 },
  { ID: 46,  UserID: 'S000000035', OrgID: 'BSX', FName: 'Yuvaraj',      LName: 'Kumar',        Email: 'Yuvaraj.kumar@bluestonex.com',        EmpID: 'S000000035', UserTypeKey: 'S', BaseSiteKey: 'UKOSW', ManagerID: 'S000000008', IsActive: 'Y', TargetUtilization: 75, TargetHrsPerWeek: '40:00', BonusPercent: 3, PensionRate: 0 },
  { ID: 116, UserID: '41BF363FB0AD3100F000000246A75000', OrgID: 'BSX', FName: 'Suresh', LName: 'Rajarathinam', Email: 'Suresh.Rajarathinam@Bluestonex.com', EmpID: '41BF363FB0AD3100F000000246A75000', UserTypeKey: 'S', BaseSiteKey: 'INAUG', ManagerID: 'S000000008', IsActive: 'Y', TargetUtilization: 75, TargetHrsPerWeek: '40:00', BonusPercent: 3, PensionRate: 0 }
];

module.exports = async (db) => {
  // Extra guard: never seed a production/HANA database (init.js won't run under
  // the HDI deployer, but this is belt-and-suspenders).
  if (cds.env.profiles && cds.env.profiles.includes('production')) return;

  const { EMPLOYEES } = db.entities('EXP');
  await db.run(INSERT.into(EMPLOYEES).entries(SAMPLE_EMPLOYEES));
};
