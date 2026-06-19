using com.bluestonex.expense as db from '../db/schema';

// ═══════════════════════════════════════════════════════════════════════════
//  ExpenseService — Employee app (My Expenses)
//  Each underlying entity is projected exactly ONCE → no redirection conflicts
// ═══════════════════════════════════════════════════════════════════════════
@path: '/expense'
@requires: 'authenticated-user'
service ExpenseService {

  @odata.draft.enabled
  @restrict: [{ grant: '*', to: 'Employee', where: 'employeeEmail = $user' }]
  entity MyClaims as projection on db.ExpenseClaims {
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
    @(Core.OperationAvailable: { $edmJson: { $Eq: [{ $Path: 'in/status' }, 'Draft'] } })
    action submitClaim() returns MyClaims;
  };

  entity MyClaimItems    as projection on db.ExpenseItems;
  entity MyMileageClaims as projection on db.MileageClaims;

  @readonly entity ExpenseTypes as projection on db.ExpenseTypes;
  @readonly entity VATTypes     as projection on db.VATTypes;
  @readonly entity Employees    as projection on db.Employees
                                   excluding { manager, createdAt, createdBy, modifiedAt, modifiedBy };
}

annotate ExpenseService.MyClaims with {
  ID                @UI.Hidden;
  statusCriticality @UI.Hidden;
  employeeEmail     @UI.Hidden;
  employeeName      @title: 'Employee';
  department        @title: 'Department';
  employeeSite      @title: 'Site';
}

annotate ExpenseService.MyClaimItems with {
  ID      @UI.Hidden;
  vatType @Common.ValueList: {
            CollectionPath: 'VATTypes',
            Parameters: [
              { $Type: 'Common.ValueListParameterInOut',       LocalDataProperty: vatType, ValueListProperty: 'code' },
              { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'description' }
            ]
          };
};

annotate ExpenseService.MyMileageClaims with { ID @UI.Hidden; };
