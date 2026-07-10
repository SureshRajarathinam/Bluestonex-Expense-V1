using EXP as db from '../db/schema';

// ═══════════════════════════════════════════════════════════════════════════
//  ApprovalService — merged Approvals + Policy Config + Workflow Members
//  UK = 2-level approval, India = 1-level (driven by ApprovalWorkflow config)
// ═══════════════════════════════════════════════════════════════════════════
// ── Dashboard analytics payload (read-only aggregation; see dashboardStats) ──
type DashCount : { UK : Integer; ![IN] : Integer; total : Integer; }
type DashMoney : { gbp : Decimal(15,2); inr : Decimal(15,2); }
type DashCat   : { code : String; description : String; gbp : Decimal(15,2); inr : Decimal(15,2); }
type DashGeo   : { code : String; country : String; claims : Integer;
                   approved : Integer; awaiting : Integer; rejected : Integer;
                   gbp : Decimal(15,2); inr : Decimal(15,2); }
type DashTrend : { month : String; submitted : Integer; approved : Integer; rejected : Integer; }
type DashStats : {
  awaiting        : DashCount;
  approved        : DashCount;
  rejected        : DashCount;
  spendByCategory : many DashCat;   // approved spend by category (bars)
  expenseItems    : many DashCat;   // ALL expense items by category (Top Expense Items donut)
  spendByCountry  : many DashGeo;
  trend           : many DashTrend;
}

// ── Claim journey payload (History detail: timeline + assigned approvers) ────
type JourneyEvent : { action : String; at : DateTime; ![by] : String; note : String; }
type JourneyAtt   : { itemID : String; fileName : String; expenseType : String; gross : Decimal(15,2); }
type ClaimJourney : {
  claimNumber    : String;
  employeeName   : String;
  employeeNumber : String;
  createdBy      : String;
  country        : String;
  currency       : String;
  totalGross     : Decimal(15,2);
  assignedL1     : String;   // configured level-1 approver (from WORKFLOW)
  assignedL2     : String;   // configured level-2 approver (UK only)
  approvedL1By   : String;
  approvedL2By   : String;
  returnedBy     : String;
  resubmitCount  : Integer;
  attachments    : many JourneyAtt;
  events         : many JourneyEvent;
}

@path: '/approval'
@requires: 'authenticated-user'
service ApprovalService {

  // ── Approvals queue: claims awaiting a decision ─────────────────────────────
  @restrict: [{ grant: ['READ', 'approve', 'reject'], to: 'Approver' }]
  entity Approvals as select from db.CLAIMS {
    *,
    employee.fullName       as employeeName   : String,
    employee.employeeNumber as employeeNumber : String,
    employee.email          as employeeEmail  : String,
    employee.department     as department     : String,
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

  // Transactional line data — restrict to approvers/admins (fix D9); previously
  // readable by ANY authenticated user, including employee-only accounts.
  @readonly
  @restrict: [{ grant: 'READ', to: 'Approver' }, { grant: 'READ', to: 'Admin' }]
  entity ApprovalItems   as projection on db.ITEMS;
  @readonly
  @restrict: [{ grant: 'READ', to: 'Approver' }, { grant: 'READ', to: 'Admin' }]
  entity ApprovalMileage as projection on db.MILEAGE;

  // ── History: every non-draft claim (org-wide), read-only ────────────────────
  // Not a redirection target — keep Approvals as the target for items/mileage assocs.
  @cds.redirection.target: false
  @readonly
  @restrict: [{ grant: 'READ', to: 'Approver' }, { grant: 'READ', to: 'Admin' }]
  entity ClaimHistory as select from db.CLAIMS {
    *,
    employee.fullName       as employeeName   : String,
    employee.employeeNumber as employeeNumber : String,
    employee.email          as employeeEmail  : String,
    employee.department     as department     : String,
    case status
      when 'Submitted'     then 2
      when 'FirstApproved' then 2
      when 'Approved'      then 3
      when 'Returned'      then 2   // amber — returned to the employee for rework
      when 'Rejected'      then 1
      else 0
    end as statusCriticality : Integer,
    // Batch-enriched in an after('READ') handler (NOT computed in SQL): count of
    // items with an uploaded receipt, and how many times the claim was resubmitted.
    virtual null as attachmentCount : Integer,
    virtual null as resubmitCount   : Integer
  } where status <> 'Draft' order by submittedAt desc;

  // ── Server-side PDF export (Approver/Admin). Returns the PDF as base64
  //    (LargeBinary in OData JSON); the UI decodes it to a Blob and downloads. ──
  @requires: [ 'Approver', 'Admin' ]
  function exportClaimsPdf(
    scope    : String,   // 'approvals' | 'history'
    status   : String,
    country  : String,
    claimNo  : String,
    fromDate : Date,
    toDate   : Date
  ) returns LargeBinary;

  // ── Dashboard analytics (Approver/Admin) — read-only aggregation over CLAIMS.
  //    fromDate/toDate scope the KPIs; country ∈ 'ALL' | 'UK' | 'IN'. ──
  @requires: [ 'Approver', 'Admin' ]
  function dashboardStats(fromDate : Date, toDate : Date, country : String) returns DashStats;

  // ── Claim journey (Approver/Admin) — lazy per-claim detail for the History
  //    timeline: assigned approvers, who decided, attachments, and the full
  //    ordered audit trail (Submitted → Returned → Resubmitted → Approved …). ──
  @requires: [ 'Approver', 'Admin' ]
  function claimJourney(claimNumber : String) returns ClaimJourney;

  // ── Policy Configuration (Admin) — draft-enabled for Fiori Elements edit ───
  @odata.draft.enabled
  @restrict: [{ grant: '*', to: 'Admin' }]
  entity Policies as projection on db.POLICY;

  // ── Approval Workflow Members (Admin) — draft-enabled for FE edit ──────────
  @odata.draft.enabled
  @restrict: [{ grant: '*', to: 'Admin' }]
  entity WorkflowMembers as projection on db.WORKFLOW;

  // ── Audit log (read-only) ──────────────────────────────────────────────────
  @readonly
  @restrict: [{ grant: 'READ', to: 'Admin' }]
  entity AuditLogs as projection on db.AUDITLOG order by timestamp desc;

  // ── Value helps ─────────────────────────────────────────────────────────────
  @readonly entity Countries    as projection on db.COUNTRIES;
  @readonly entity ExpenseTypes as projection on db.EXPENSE_TYPES;
  @readonly entity VATTypes     as projection on db.VAT_TYPES;
  @readonly entity Roles        as projection on db.ROLES;
  @readonly entity Employees    as projection on db.EMPLOYEES
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

annotate ApprovalService.ClaimHistory with {
  ID                @UI.Hidden;
  statusCriticality @UI.Hidden;
  employeeEmail     @UI.Hidden;
  employeeName      @title: 'Employee';
  department        @title: 'Department';
}

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
