'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  USERS_MASTER read helper — the single employee-master access point.
//
//  WHY THIS EXISTS (Plan B):
//  The org `USERS_MASTER` lives in ANOTHER HDI container. Our container reaches it
//  through the cross-container synonym `USERS_MASTER_SYN` (db/src/USERS_MASTER.hdbsynonym)
//  and the container role `ExpenseAppRole` (granted to our runtime user in
//  db/src/USERS_MASTER.hdbgrants → application_user.container_roles).
//
//  We deliberately do NOT read it through CAP CQL on HANA. CAP would target the
//  #OO-owned wrapper view `EXT_USERSMASTER`, and reading a view owned by the
//  container's technical user requires that owner to hold the underlying SELECT
//  *WITH GRANT OPTION* (HANA definer rights) — which the org role does not grant,
//  so every such read 500s with `insufficient privilege`.
//
//  Instead the RUNTIME user reads the SYNONYM directly via native SQL. A synonym is
//  transparent (no definer indirection), so a plain role-granted SELECT is enough —
//  no grant option, no owner action required.
//
//  DEV/TEST (SQLite): there is no synonym; db/init.js seeds a local `ext_UsersMaster`
//  table. There we use ordinary CAP CQL against `ext.UsersMaster`.
//
//  Columns are the org table's real MIXED-CASE names, quoted so HANA preserves case
//  (the reason the wrapper view existed). Result rows are keyed exactly as
//  ext.UsersMaster elements (ID, FName, LName, Email, EmpID, BaseSiteKey, …) on BOTH
//  databases, so every caller is DB-agnostic.
// ─────────────────────────────────────────────────────────────────────────────

const cds = require('@sap/cds');

// ext.UsersMaster element names == org USERS_MASTER column names (case-sensitive).
const COLS = ['ID', 'UserID', 'OrgID', 'FName', 'LName', 'Email', 'Mobile',
  'EmpID', 'UserTypeKey', 'BaseSiteKey', 'ManagerID', 'IsActive'];
const SEL = COLS.map((c) => `"${c}"`).join(', ');
const SYN = '"USERS_MASTER_SYN"';

// True on a HANA datasource (production). Anything else (SQLite dev/test) → CQL path.
// Checked from several angles so the HANA service can NEVER fall through to the CQL
// path (that would re-hit the #OO-owned wrapper view → the 'insufficient privilege'
// 500 this whole module exists to avoid).
const isHana = () => {
  const db = cds.db;
  const signals = [
    db && db.kind,
    db && db.options && db.options.kind,
    db && db.constructor && db.constructor.name,
    cds.env && cds.env.requires && cds.env.requires.db && cds.env.requires.db.kind
  ];
  return signals.some((s) => String(s || '').toLowerCase().includes('hana'));
};

// Native quoted-identifier read of the synonym (HANA only). `where` uses '?' params.
const hanaSelect = (where, params) =>
  cds.db.run(`SELECT ${SEL} FROM ${SYN}${where ? ` WHERE ${where}` : ''}`, params || []);

// ── Public API ──────────────────────────────────────────────────────────────

// Rows for a set of USERS_MASTER.ID values (order not guaranteed). De-dupes input.
async function findByIds(ids) {
  const list = [...new Set((ids || []).filter((v) => v != null))];
  if (!list.length) return [];
  if (isHana()) return hanaSelect(`"ID" IN (${list.map(() => '?').join(', ')})`, list);
  const { UsersMaster } = cds.entities('ext');
  return SELECT.from(UsersMaster).where({ ID: { in: list } });
}

// Rows whose Email (case-insensitive) matches any of the given identities.
async function findByEmails(emails) {
  const list = [...new Set((emails || [])
    .map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))];
  if (!list.length) return [];
  if (isHana()) return hanaSelect(`LOWER("Email") IN (${list.map(() => '?').join(', ')})`, list);
  const { UsersMaster } = cds.entities('ext');
  return SELECT.from(UsersMaster).where(`lower(Email) in`, list);
}

// Single row for an email (case-insensitive), or null.
async function findByEmail(email) {
  if (!email) return null;
  const rows = await findByEmails([email]);
  return rows[0] || null;
}

// All rows — feeds the Admin approver picker (ApprovalService.Employees on READ).
async function listAll() {
  if (isHana()) return hanaSelect('', []);
  const { UsersMaster } = cds.entities('ext');
  return SELECT.from(UsersMaster);
}

// Convenience: { <String(ID)>: row } for batch enrichment.
async function mapByIds(ids) {
  const rows = await findByIds(ids);
  const m = {};
  for (const r of rows) m[String(r.ID)] = r;
  return m;
}

// Full name from a raw row: "FName LName" (trimmed), or ''.
const fullName = (r) => (r ? [r.FName, r.LName].filter(Boolean).join(' ').trim() : '');

module.exports = { findByIds, findByEmails, findByEmail, listAll, mapByIds, fullName };
