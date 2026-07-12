'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  Employee identity resolver (HYBRID source)
//
//    dev / test  →  EXP_EMPLOYEES (seeded SQLite)                [default]
//    production  →  ext.UsersMaster (USERS_MASTER via synonym)   [EMPLOYEE_SOURCE=USERS_MASTER]
//
//  Returns a NORMALISED identity (never the raw row) so callers never couple to
//  either schema:
//    { email, fullName, employeeNumber, site, active, externalId }
//
//  ⚠ Not yet wired into the claim WRITE path. `claim.employee` is a UUID FK to
//  EXP_EMPLOYEES; USERS_MASTER uses a BIGINT PK in a different identity space, so
//  the FK/linkage strategy is a deploy-time decision (see db/external/README.md).
//  This helper covers identity + display lookups only, and is the single place to
//  flip the source once the cross-container grant is confirmed and deployed.
// ─────────────────────────────────────────────────────────────────────────────

const cds = require('@sap/cds');

const useUsersMaster = () => process.env.EMPLOYEE_SOURCE === 'USERS_MASTER';

async function findByEmail(email) {
  if (!email) return null;

  if (useUsersMaster()) {
    const { UsersMaster } = cds.entities('ext');
    const key = String(email).toLowerCase();
    // Case-insensitive email match; prefer an active row.
    const rows = await SELECT.from(UsersMaster).where(`lower(Email) =`, key);
    const u = rows.find((r) => String(r.IsActive || '').toUpperCase() !== 'N') || rows[0];
    if (!u) return null;
    return {
      email: u.Email,
      fullName: [u.FName, u.LName].filter(Boolean).join(' ').trim(),
      employeeNumber: u.EmpID,
      site: u.BaseSiteKey,
      active: String(u.IsActive || '').toUpperCase() !== 'N',
      externalId: u.ID
    };
  }

  // EXP_EMPLOYEES is now an exact USERS_MASTER mirror (FName/LName/Email/EmpID/…).
  // Match on Email case-insensitively; prefer an active ('Y') row.
  const { EMPLOYEES } = cds.entities('EXP');
  const rows = await SELECT.from(EMPLOYEES).where(`lower(Email) =`, String(email).toLowerCase());
  const e = rows.find((r) => String(r.IsActive || '').toUpperCase() !== 'N') || rows[0];
  if (!e) return null;
  return {
    email: e.Email,
    fullName: [e.FName, e.LName].filter(Boolean).join(' ').trim(),
    employeeNumber: e.EmpID,
    site: e.BaseSiteKey,
    active: String(e.IsActive || '').toUpperCase() !== 'N',
    externalId: e.ID
  };
}

module.exports = { findByEmail, useUsersMaster };
