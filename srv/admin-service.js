'use strict';

const cds = require('@sap/cds');
const audit = require('./lib/audit');

const LOG = cds.log('admin-service');

module.exports = class AdminService extends cds.ApplicationService {

  async init() {
    // ─── Policy: validate sane values, then audit the change ───────────────
    this.before(['CREATE', 'UPDATE'], 'Policies', (req) => {
      const p = req.data;
      if (p.mileageRate != null && Number(p.mileageRate) <= 0)
        return req.error(422, 'Mileage rate must be greater than 0.');
      for (const [f, label] of [['hotelDailyLimit', 'Hotel daily limit'], ['mealDailyLimit', 'Meal daily limit'], ['receiptThreshold', 'Receipt threshold']]) {
        if (p[f] != null && Number(p[f]) < 0) return req.error(422, `${label} cannot be negative.`);
      }
      if (p.vatRate != null && (Number(p.vatRate) < 0 || Number(p.vatRate) > 1))
        return req.error(422, 'VAT rate must be between 0 and 1 (e.g. 0.20 for 20%).');
    });

    this.after(['CREATE', 'UPDATE'], 'Policies', async (data, req) => {
      await audit.record({
        userId: req.user.id, action: 'PolicyChanged', objectType: 'ExpensePolicy',
        objectKey: data?.policyName || '',
        details: `mileageRate=${data?.mileageRate}, hotelLimit=${data?.hotelDailyLimit}, mealLimit=${data?.mealDailyLimit}, receiptThreshold=${data?.receiptThreshold}`
      });
      LOG.info(`Policy '${data?.policyName}' updated by ${req.user.id}`);
    });

    // ─── User: basic checks, then audit ────────────────────────────────────
    this.before(['CREATE', 'UPDATE'], 'Users', (req) => {
      const u = req.data;
      if (u.email != null && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u.email))
        return req.error(422, 'A valid email address is required.');
    });

    this.after(['CREATE', 'UPDATE'], 'Users', async (data, req) => {
      await audit.record({
        userId: req.user.id, action: 'UserChanged', objectType: 'Employee',
        objectKey: data?.employeeNumber || data?.email || '',
        details: `name=${data?.fullName}, role=${data?.role}, active=${data?.active}`
      });
      LOG.info(`User '${data?.email}' updated by ${req.user.id}`);
    });

    this.after('DELETE', 'Users', async (_, req) => {
      await audit.record({
        userId: req.user.id, action: 'UserChanged', objectType: 'Employee',
        objectKey: String(req.params?.[0]?.ID || req.params?.[0] || ''),
        details: 'User deleted'
      });
    });

    await super.init();
  }
};
