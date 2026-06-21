using com.bluestonex.expense as db from '../db/schema';

// ═══════════════════════════════════════════════════════════════════════════
//  AdminService — Expense Administration (governance)
//  Policy configuration · user & role management · audit log · health metrics
// ═══════════════════════════════════════════════════════════════════════════
@path: '/admin'
@requires: 'Admin'
service AdminService {

  // ── Policy Configuration ───────────────────────────────────────────────────
  @odata.draft.enabled
  @restrict: [{ grant: '*', to: 'Admin' }]
  entity Policies as projection on db.ExpensePolicy;

  // ── User & Role Management ─────────────────────────────────────────────────
  @odata.draft.enabled
  @restrict: [{ grant: '*', to: 'Admin' }]
  entity Users as projection on db.Employees
                   excluding { manager };

  @readonly entity Roles as projection on db.Roles;

  // ── Audit Log (read-only, newest first) ────────────────────────────────────
  @readonly
  @restrict: [{ grant: 'READ', to: 'Admin' }]
  entity AuditLogs as projection on db.AuditLog order by timestamp desc;

  // ── System Health Metrics (read-only analytical view) ──────────────────────
  @readonly
  @restrict: [{ grant: 'READ', to: 'Admin' }]
  @cds.redirection.target: false
  entity SystemHealth as
    select from db.ExpenseClaims {
      key status                       as status      : String,
          count(*)                     as claimCount  : Integer,
          sum(totalGross)              as totalAmount : Decimal(15, 2),
          'GBP'                        as currency    : String
    }
    group by status;
}

// ─── Annotations: labels ─────────────────────────────────────────────────────

annotate AdminService.Policies with {
  ID               @UI.Hidden;
  policyName       @title: 'Policy Name';
  mileageRate      @title: 'Mileage Rate (£/mile)';
  hotelDailyLimit  @title: 'Hotel Daily Limit (£)';
  mealDailyLimit   @title: 'Meal Daily Limit (£)';
  receiptThreshold @title: 'Receipt Threshold (£)';
  vatRate          @title: 'VAT Rate';
  effectiveFrom    @title: 'Effective From';
  effectiveTo      @title: 'Effective To';
}

annotate AdminService.Users with {
  ID             @UI.Hidden;
  employeeNumber @title: 'Employee Number';
  fullName       @title: 'Full Name';
  email          @title: 'Email';
  site           @title: 'Site / Address';
  department     @title: 'Department';
  payrollArea    @title: 'Payroll Area';
  active         @title: 'Active';
  financeEmail   @title: 'Finance Approver Email';
  role           @title: 'Role'
                 @Common.ValueList: {
                   CollectionPath: 'Roles',
                   Parameters: [
                     { $Type: 'Common.ValueListParameterInOut',       LocalDataProperty: role, ValueListProperty: 'code' },
                     { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'description' }
                   ]
                 };
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

annotate AdminService.SystemHealth with {
  status      @title: 'Status';
  claimCount  @title: 'Number of Claims';
  totalAmount @title: 'Total Amount (£)' @Measures.ISOCurrency: currency;
  currency    @UI.Hidden;
}
