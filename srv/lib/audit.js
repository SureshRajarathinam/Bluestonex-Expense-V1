'use strict';

const cds = require('@sap/cds');
const LOG = cds.log('audit');

// Append an immutable audit-trail entry. Best-effort: never breaks the
// business flow if logging itself fails.
async function record({ userId, action, objectType, objectKey, details }) {
  try {
    const { AuditLog } = cds.entities('com.bluestonex.expense');
    await INSERT.into(AuditLog).entries({
      ID: cds.utils.uuid(),
      timestamp: new Date().toISOString(),
      userId: userId || 'system',
      action,
      objectType: objectType || '',
      objectKey: objectKey || '',
      details: (details || '').slice(0, 1000)
    });
  } catch (err) {
    LOG.error('audit write failed:', err.message);
  }
}

module.exports = { record };
