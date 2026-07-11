'use strict';

// OData V4 $top/$skip hardening.
// CAP silently ignores malformed $top/$skip (e.g. "-1", "abc") and returns 200,
// which hides client bugs and can mask unbounded reads. This guard rejects any
// non-negative-integer value with a 400 before the query runs. Register via
//   this.before('READ', guardPaging)
// The raw query string is authoritative (the parser may have already dropped a
// bad value), with a fallback to the parsed SELECT.limit for non-HTTP contexts.
function guardPaging(req) {
  const raw = req._ && req._.req && req._.req.query;
  if (raw) {
    for (const k of ['$top', '$skip']) {
      if (k in raw && !/^\d+$/.test(String(raw[k]))) {
        return req.reject(400, `Invalid ${k} value '${raw[k]}' — expected a non-negative integer.`);
      }
    }
    return;
  }
  // Fallback: inspect the parsed limit (offset/rows) when no HTTP request is present.
  const lim = req.query && req.query.SELECT && req.query.SELECT.limit;
  if (!lim) return;
  const top = lim.rows && lim.rows.val;
  const skip = lim.offset && lim.offset.val;
  if (top != null && (!Number.isInteger(top) || top < 0)) return req.reject(400, 'Invalid $top value.');
  if (skip != null && (!Number.isInteger(skip) || skip < 0)) return req.reject(400, 'Invalid $skip value.');
}

module.exports = { guardPaging };
