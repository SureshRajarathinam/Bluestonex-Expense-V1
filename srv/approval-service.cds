using com.bluestonex.expense as db from '../db/schema';

// ═══════════════════════════════════════════════════════════════════════════
//  ApprovalService — merged Approvals + Policy Config + Workflow Members
//  UK = 2-level approval, India = 1-level (driven by ApprovalWorkflow config)
// ═══════════════════════════════════════════════════════════════════════════
@path: '/approval'
@requires: 'authenticated-user'
service ApprovalService {

  // ── Approvals queue: claims awaiting a decision ─────────────────────────────
  @restrict: [{ grant: ['READ', 'approve', 'reject'], to: 'Approver' }]
  entity Approvals as select from db.ExpenseClaims {
    *,
    employee.fullName   as employeeName  : String,
    employee.email      as employeeEmail : String,
    employee.department as department    : String,
    case status
      when 'Draft'         then 0
      when 'Submitted'     then 2
      when 'FirstApproved' then 2
      when 'Approved'      then 3
      when 'Rejected'      then 1
      else 0
    end as statusCriticality : Integer
  } where status in ('Submitted', 'FirstApproved') actions {
    @(Core.OperationAvailable: {
      $edmJson: { $Or: [
        { $Eq: [{ $Path: 'in/status' }, 'Submitted'] },
        { $Eq: [{ $Path: 'in/status' }, 'FirstApproved'] }
      ] }
    })
    action approve(comment : String(500)) returns Approvals;

    @(Core.OperationAvailable: {
      $edmJson: { $Or: [
        { $Eq: [{ $Path: 'in/status' }, 'Submitted'] },
        { $Eq: [{ $Path: 'in/status' }, 'FirstApproved'] }
      ] }
    })
    action reject(comment : String(500)) returns Approvals;
  };

  @readonly entity ApprovalItems   as projection on db.ExpenseItems;
  @readonly entity ApprovalMileage as projection on db.MileageClaims;

  // ── Policy Configuration (Admin) — draft-enabled for Fiori Elements edit ───
  @odata.draft.enabled
  @restrict: [{ grant: '*', to: 'Admin' }]
  entity Policies as projection on db.ExpensePolicy;

  // ── Approval Workflow Members (Admin) — draft-enabled for FE edit ──────────
  @odata.draft.enabled
  @restrict: [{ grant: '*', to: 'Admin' }]
  entity WorkflowMembers as projection on db.ApprovalWorkflow;

  // ── Audit log (read-only) ──────────────────────────────────────────────────
  @readonly
  @restrict: [{ grant: 'READ', to: 'Admin' }]
  entity AuditLogs as projection on db.AuditLog order by timestamp desc;

  // ── Value helps ─────────────────────────────────────────────────────────────
  @readonly entity Countries    as projection on db.Countries;
  @readonly entity ExpenseTypes as projection on db.ExpenseTypes;
  @readonly entity VATTypes     as projection on db.VATTypes;
  @readonly entity Roles        as projection on db.Roles;
  @readonly entity Employees    as projection on db.Employees
                                   excluding { manager, createdAt, createdBy, modifiedAt, modifiedBy };
}

// ─── Labels ──────────────────────────────────────────────────────────────────

annotate ApprovalService.Approvals with {
  ID                @UI.Hidden;
  statusCriticality @UI.Hidden;
  employeeEmail     @UI.Hidden;
  employeeName      @title: 'Employee';
  department        @title: 'Department';
}

annotate ApprovalService.ApprovalItems   with { ID @UI.Hidden; };
annotate ApprovalService.ApprovalMileage with { ID @UI.Hidden; };

annotate ApprovalService.Policies with {
  ID               @UI.Hidden;
  policyName       @title: 'Policy Name';
  mileageRate      @title: 'Mileage Rate (£/mile)';
  hotelDailyLimit  @title: 'Hotel Daily Limit';
  mealDailyLimit   @title: 'Meal Daily Limit';
  receiptThreshold @title: 'Receipt Threshold';
  vatRate          @title: 'UK VAT Rate';
  gstRate          @title: 'India GST Rate';
}

annotate ApprovalService.WorkflowMembers with {
  country        @title: 'Country';
  countryName    @title: 'Country Name';
  firstApprover  @title: 'First-Level Approver';
  secondApprover @title: 'Second-Level Approver';
}
