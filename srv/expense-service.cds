using com.bluestonex.expense as db from '../db/schema';

@path: '/expense'
service ExpenseService {

  // ─── Employee View ──────────────────────────────────────────────────────
  // Draft-enabled so employees can save progress before submitting
  @odata.draft.enabled
  @restrict: [{ grant: '*', to: 'Employee', where: 'employee.email = $user' }]
  entity MyClaims as select from db.ExpenseClaims {
    *,
    employee.fullName   as employeeName   : String,
    employee.email      as employeeEmail  : String,
    employee.site       as employeeSite   : String,
    employee.department as department     : String,
    case status
      when 'Draft'           then 0
      when 'Submitted'       then 2
      when 'ManagerApproved' then 2
      when 'FinanceApproved' then 3
      when 'Settled'         then 3
      when 'Rejected'        then 1
      else 0
    end as statusCriticality : Integer
  } actions {
    @(Core.OperationAvailable: { $edmJson: { $Eq: [{ $Path: 'in/status' }, 'Draft'] } })
    action submitClaim() returns MyClaims;
  };

  @restrict: [{ grant: '*', to: 'Employee' }]
  entity MyClaimItems    as projection on db.ExpenseItems;

  @restrict: [{ grant: '*', to: 'Employee' }]
  entity MyMileageClaims as projection on db.MileageClaims;

  // ─── Manager View ───────────────────────────────────────────────────────
  @restrict: [{ grant: ['READ', 'approveClaim', 'rejectClaim'], to: 'Manager' }]
  entity TeamClaims as select from db.ExpenseClaims {
    *,
    employee.fullName   as employeeName   : String,
    employee.email      as employeeEmail  : String,
    employee.site       as employeeSite   : String,
    employee.department as department     : String,
    case status
      when 'Draft'           then 0
      when 'Submitted'       then 2
      when 'ManagerApproved' then 2
      when 'FinanceApproved' then 3
      when 'Settled'         then 3
      when 'Rejected'        then 1
      else 0
    end as statusCriticality : Integer
  } actions {
    @(Core.OperationAvailable: { $edmJson: { $Eq: [{ $Path: 'in/status' }, 'Submitted'] } })
    action approveClaim(comment : String(500)) returns TeamClaims;

    @(Core.OperationAvailable: { $edmJson: { $Eq: [{ $Path: 'in/status' }, 'Submitted'] } })
    action rejectClaim(comment : String(500))  returns TeamClaims;
  };

  @restrict: [{ grant: 'READ', to: 'Manager' }]
  entity TeamClaimItems    as projection on db.ExpenseItems;

  @restrict: [{ grant: 'READ', to: 'Manager' }]
  entity TeamMileageClaims as projection on db.MileageClaims;

  // ─── Finance View ───────────────────────────────────────────────────────
  @restrict: [{ grant: ['READ', 'financeApprove', 'settleClaim', 'rejectClaim'], to: 'Finance' }]
  entity FinanceClaims as select from db.ExpenseClaims {
    *,
    employee.fullName   as employeeName   : String,
    employee.email      as employeeEmail  : String,
    employee.site       as employeeSite   : String,
    employee.department as department     : String,
    case status
      when 'Draft'           then 0
      when 'Submitted'       then 2
      when 'ManagerApproved' then 2
      when 'FinanceApproved' then 3
      when 'Settled'         then 3
      when 'Rejected'        then 1
      else 0
    end as statusCriticality : Integer
  } actions {
    @(Core.OperationAvailable: { $edmJson: { $Eq: [{ $Path: 'in/status' }, 'ManagerApproved'] } })
    action financeApprove(comment : String(500)) returns FinanceClaims;

    @(Core.OperationAvailable: { $edmJson: { $Eq: [{ $Path: 'in/status' }, 'FinanceApproved'] } })
    action settleClaim()                          returns FinanceClaims;

    @(Core.OperationAvailable: {
      $edmJson: {
        $Or: [
          { $Eq: [{ $Path: 'in/status' }, 'Submitted'] },
          { $Eq: [{ $Path: 'in/status' }, 'ManagerApproved'] }
        ]
      }
    })
    action rejectClaim(comment : String(500))     returns FinanceClaims;
  };

  @restrict: [{ grant: 'READ', to: 'Finance' }]
  entity FinanceClaimItems    as projection on db.ExpenseItems;

  @restrict: [{ grant: 'READ', to: 'Finance' }]
  entity FinanceMileageClaims as projection on db.MileageClaims;

  // ─── Value Helps ────────────────────────────────────────────────────────
  @readonly entity ExpenseTypes as projection on db.ExpenseTypes;
  @readonly entity VATTypes     as projection on db.VATTypes;
  @readonly entity Employees    as projection on db.Employees
                                   excluding { manager, createdAt, createdBy, modifiedAt, modifiedBy };
}

// ─── Semantic Annotations (shared across all apps) ──────────────────────────

annotate ExpenseService.MyClaims with {
  ID                @UI.Hidden;
  statusCriticality @UI.Hidden;
  employeeEmail     @UI.Hidden;
  claimNumber       @Common.Label: 'Claim Number';
  claimPeriod       @Common.Label: 'Claim Period';
  payrollArea       @Common.Label: 'Payroll Area';
  status            @Common.Label: 'Status';
  totalNet          @Common.Label: 'Net Amount (£)'     @Measures.ISOCurrency: currency;
  totalVAT          @Common.Label: 'VAT Amount (£)'     @Measures.ISOCurrency: currency;
  totalGross        @Common.Label: 'Total Amount (£)'   @Measures.ISOCurrency: currency;
  currency          @Common.Label: 'Currency';
  employeeName      @Common.Label: 'Employee';
  department        @Common.Label: 'Department';
  employeeSite      @Common.Label: 'Site';
  managerComment    @Common.Label: 'Manager Comments';
  financeComment    @Common.Label: 'Finance Comments';
  submittedAt       @Common.Label: 'Submitted On';
  managerApprovedAt @Common.Label: 'Manager Approved On';
  managerApprovedBy @Common.Label: 'Manager Approved By';
  financeApprovedAt @Common.Label: 'Finance Approved On';
  financeApprovedBy @Common.Label: 'Finance Approved By';
  settledAt         @Common.Label: 'Settled On';
}

annotate ExpenseService.TeamClaims   with same as ExpenseService.MyClaims;
annotate ExpenseService.FinanceClaims with same as ExpenseService.MyClaims;

annotate ExpenseService.MyClaimItems with {
  ID            @UI.Hidden;
  claim_ID      @UI.Hidden;
  expenseDate   @Common.Label: 'Date';
  expenseType   @Common.Label: 'Expense Type'
                @Common.Text: expenseType.description
                @Common.TextArrangement: #TextOnly
                @Common.ValueList: {
                  CollectionPath: 'ExpenseTypes',
                  Parameters: [
                    { $Type: 'Common.ValueListParameterOut', LocalDataProperty: expenseType_code, ValueListProperty: 'code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'description' }
                  ]
                };
  destination   @Common.Label: 'Destination';
  reasonForTrip @Common.Label: 'Reason for Trip';
  vatType       @Common.Label: 'VAT Type'
                @Common.ValueList: {
                  CollectionPath: 'VATTypes',
                  Parameters: [
                    { $Type: 'Common.ValueListParameterOut',         LocalDataProperty: vatType, ValueListProperty: 'code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'description' }
                  ]
                };
  grossAmount     @Common.Label: 'Gross Amount (£)';
  netAmount       @Common.Label: 'Net Amount (£)';
  vatAmount       @Common.Label: 'VAT Amount (£)';
  receiptAttached @Common.Label: 'Receipt Attached';
  notes           @Common.Label: 'Notes';
}

annotate ExpenseService.MyMileageClaims with {
  ID            @UI.Hidden;
  claim_ID      @UI.Hidden;
  tripDate      @Common.Label: 'Trip Date';
  destination   @Common.Label: 'Destination';
  reasonForTrip @Common.Label: 'Reason for Trip';
  engineType    @Common.Label: 'Engine Type';
  milesCount    @Common.Label: 'Miles Claimed';
  ratePerMile   @Common.Label: 'Rate per Mile (£)';
  totalAmount   @Common.Label: 'Total Amount (£)';
}
