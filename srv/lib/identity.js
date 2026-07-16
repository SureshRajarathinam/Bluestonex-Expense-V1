'use strict';

// Caller-identity resolution shared by both services.
//
// In Work Zone the IdP sets `req.user.id` to the LOGON NAME (e.g. "Srajarathinam")
// while USERS_MASTER / Approval Workflow store the EMAIL — so a plain
// `req.user.id === email` check passes locally (mock login id IS the email) but
// fails when deployed. We gather the id plus every email/user_name claim available
// and match against any of them, case-insensitively.

const cds = require('@sap/cds');

// All identities the current caller might be known by, lower-cased.
function callerIdentities(req) {
  const set = new Set();
  const add = (v) => { if (v != null && String(v).trim()) set.add(String(v).trim().toLowerCase()); };
  add(req.user && req.user.id);
  const attr = (req.user && req.user.attr) || {};
  [attr.email, attr.mail, attr.userName, attr.user_name].forEach((v) => Array.isArray(v) ? v.forEach(add) : add(v));
  try { const ai = req.http && req.http.req && req.http.req.authInfo; if (ai && ai.getEmail) add(ai.getEmail()); } catch { /* not xsuaa */ }
  try { const p = req.user && req.user.tokenInfo && req.user.tokenInfo.getPayload && req.user.tokenInfo.getPayload(); if (p) { add(p.email); add(p.user_name); } } catch { /* no token */ }
  return set;
}

// Resolve the org USERS_MASTER row (ext.UsersMaster) for the caller by matching
// USERS_MASTER.Email (case-insensitively) against ANY of the caller's known
// identities. Returns the raw row (FName/LName/EmpID/BaseSiteKey/ID/…) or null.
async function resolveEmployee(req) {
  const ids = [...callerIdentities(req)];
  if (!ids.length) return null;
  const { UsersMaster } = cds.entities('ext');
  return SELECT.one.from(UsersMaster).where(`lower(Email) in`, ids);
}

module.exports = { callerIdentities, resolveEmployee };
