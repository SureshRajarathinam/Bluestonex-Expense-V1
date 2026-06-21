using com.bluestonex.expense as db from '../db/schema';

// ═══════════════════════════════════════════════════════════════════════════
//  AdminService — Expense Administration (one app, three tabs)
//  Policy configuration · user & role management · audit log
// ═══════════════════════════════════════════════════════════════════════════
@path: '/admin'
@requires: 'Admin'
service AdminService {

  // ── Policy Configuration ───────────────────────────────────────────────────
  @restrict: [{ grant: '*', to: 'Admin' }]
  entity Policies as projection on db.ExpensePolicy;

  // ── User & Role Management ─────────────────────────────────────────────────
  @restrict: [{ grant: '*', to: 'Admin' }]
  entity Users as projection on db.Employees excluding { manager };

  @readonly entity Roles as projection on db.Roles;

  // ── Audit Log (read-only, newest first) ────────────────────────────────────
  @readonly
  @restrict: [{ grant: 'READ', to: 'Admin' }]
  entity AuditLogs as projection on db.AuditLog order by timestamp desc;
}

// ─── Labels ──────────────────────────────────────────────────────────────────

annotate AdminService.Policies with {
  ID               @UI.Hidden;
  policyName       @title: 'Policy Name';
  mileageRate      @title: 'Mileage Rate (£/mile)';
  hotelDailyLimit  @title: 'Hotel Daily Limit (£)';
  mealDailyLimit   @title: 'Meal Daily Limit (£)';
  receiptThreshold @title: 'Receipt Threshold (£)';
  vatRate          @title: 'VAT Rate';
}

annotate AdminService.Users with {
  ID             @UI.Hidden;
  employeeNumber @title: 'Employee Number';
  fullName       @title: 'Full Name';
  email          @title: 'Email';
  department     @title: 'Department';
  role           @title: 'Role';
  active         @title: 'Active';
}

annotate AdminService.AuditLogs with {
  ID         @UI.Hidden;
  timestamp  @title: 'Timestamp';
  userId     @title: 'User';
  action     @title: 'Action';
  objectType @title: 'Object Type';
  objectKey  @title: 'Reference';
  details    @title: 'Details';
}
