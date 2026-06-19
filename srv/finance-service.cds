using com.bluestonex.expense as db from '../db/schema';

// ═══════════════════════════════════════════════════════════════════════════
//  FinanceService — Finance app (Finance Expenses)
// ═══════════════════════════════════════════════════════════════════════════
@path: '/finance'
@requires: 'Finance'
service FinanceService {

  @restrict: [{ grant: ['READ', 'financeApprove', 'settleClaim', 'rejectClaim'], to: 'Finance' }]
  entity FinanceClaims as projection on db.ExpenseClaims {
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
    @(Core.OperationAvailable: { $edmJson: { $Eq: [{ $Path: 'in/status' }, 'ManagerApproved'] } })
    action financeApprove(comment : String(500)) returns FinanceClaims;

    @(Core.OperationAvailable: { $edmJson: { $Eq: [{ $Path: 'in/status' }, 'FinanceApproved'] } })
    action settleClaim()                          returns FinanceClaims;

    @(Core.OperationAvailable: {
      $edmJson: { $Or: [
        { $Eq: [{ $Path: 'in/status' }, 'Submitted'] },
        { $Eq: [{ $Path: 'in/status' }, 'ManagerApproved'] }
      ] }
    })
    action rejectClaim(comment : String(500))     returns FinanceClaims;
  };

  @readonly entity FinanceClaimItems    as projection on db.ExpenseItems;
  @readonly entity FinanceMileageClaims as projection on db.MileageClaims;
  @readonly entity ExpenseTypes         as projection on db.ExpenseTypes;
  @readonly entity VATTypes             as projection on db.VATTypes;
}

annotate FinanceService.FinanceClaims with {
  ID                @UI.Hidden;
  statusCriticality @UI.Hidden;
  employeeEmail     @UI.Hidden;
  employeeName      @title: 'Employee';
  department        @title: 'Department';
  employeeSite      @title: 'Site';
}
annotate FinanceService.FinanceClaimItems    with { ID @UI.Hidden; };
annotate FinanceService.FinanceMileageClaims with { ID @UI.Hidden; };
