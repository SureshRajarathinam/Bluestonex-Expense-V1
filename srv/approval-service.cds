using com.bluestonex.expense as db from '../db/schema';

// ═══════════════════════════════════════════════════════════════════════════
//  ApprovalService — Manager app (Approve Expenses)
// ═══════════════════════════════════════════════════════════════════════════
@path: '/approval'
@requires: 'authenticated-user'
service ApprovalService {

  @restrict: [{ grant: ['READ', 'approveClaim', 'rejectClaim'], to: 'Manager' }]
  entity TeamClaims as projection on db.ExpenseClaims {
    *,
    employee.fullName   as employeeName  : String,
    employee.email      as employeeEmail : String,
    employee.site       as employeeSite  : String,
    employee.department as department    : String,
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

  @readonly entity TeamClaimItems    as projection on db.ExpenseItems;
  @readonly entity TeamMileageClaims as projection on db.MileageClaims;
  @readonly entity ExpenseTypes      as projection on db.ExpenseTypes;
  @readonly entity VATTypes          as projection on db.VATTypes;
  @readonly entity Employees         as projection on db.Employees
                                        excluding { manager, createdAt, createdBy, modifiedAt, modifiedBy };
}

annotate ApprovalService.TeamClaims with {
  ID                @UI.Hidden;
  statusCriticality @UI.Hidden;
  employeeEmail     @UI.Hidden;
  employeeName      @title: 'Employee';
  department        @title: 'Department';
  employeeSite      @title: 'Site';
}
annotate ApprovalService.TeamClaimItems    with { ID @UI.Hidden; };
annotate ApprovalService.TeamMileageClaims with { ID @UI.Hidden; };
