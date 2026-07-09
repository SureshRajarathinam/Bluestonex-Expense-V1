using EXP as db from '../db/schema';

// ═══════════════════════════════════════════════════════════════════════════
//  ExpenseService — Employee app (My Expenses)
//  Each underlying entity is projected exactly ONCE → no redirection conflicts
// ═══════════════════════════════════════════════════════════════════════════
@path: '/expense'
@requires: 'authenticated-user'
service ExpenseService {

  @odata.draft.enabled
  // Ownership = the user who created the claim (managed `createdBy` = $user on
  // insert). Using createdBy — not the employee association — means any
  // authenticated Employee owns the claims they create even if they are not a
  // pre-seeded EMPLOYEES row (otherwise employeeEmail is null → own claim reads
  // 404 and submitClaim 403).
  @restrict: [{ grant: '*', to: 'Employee', where: 'createdBy = $user' }]
  entity MyClaims as projection on db.CLAIMS {
    *,
    employee.fullName       as employeeName   : String,
    employee.employeeNumber as employeeNumber : String,
    employee.email          as employeeEmail  : String,
    employee.site           as employeeSite   : String,
    employee.department     as department     : String,
    case status
      when 'Draft'         then 0
      when 'Submitted'     then 2
      when 'FirstApproved' then 2
      when 'Approved'      then 3
      when 'Returned'      then 2   // amber — declined, back with the employee to rework
      when 'Rejected'      then 1
      else 0
    end as statusCriticality : Integer
  } actions {
    // Offered on a Draft OR a Returned claim (rework loop: an approver decline
    // sends the claim back to the employee, who fixes it and resubmits).
    @(Core.OperationAvailable: { $edmJson: { $Or: [
      { $Eq: [{ $Path: 'in/status' }, 'Draft'] },
      { $Eq: [{ $Path: 'in/status' }, 'Returned'] }
    ] } })
    action submitClaim() returns MyClaims;
  };

  // Own-rows only: these child sets are reachable directly (e.g. the receipt
  // media PUT), so they carry the same ownership filter as MyClaims (by the
  // parent claim's creator) — otherwise the row-level security on the header is
  // bypassable (fix D10).
  @restrict: [{ grant: '*', to: 'Employee', where: 'claim.createdBy = $user' }]
  entity MyClaimItems    as projection on db.ITEMS;
  @restrict: [{ grant: '*', to: 'Employee', where: 'claim.createdBy = $user' }]
  entity MyMileageClaims as projection on db.MILEAGE;

  @readonly entity Countries    as projection on db.COUNTRIES;
  @readonly entity ExpenseTypes as projection on db.EXPENSE_TYPES;
  @readonly entity VATTypes     as projection on db.VAT_TYPES;
  // Read-only so the UI can preview the net/VAT split live as gross is typed
  // (server before('SAVE') stays the source of truth for saved values).
  @readonly entity Policies     as projection on db.POLICY;
  @readonly entity Employees    as projection on db.EMPLOYEES
                                   excluding { manager, createdAt, createdBy, modifiedAt, modifiedBy };
}

annotate ExpenseService.MyClaims with {
  ID                @UI.Hidden;
  statusCriticality @UI.Hidden;
  employeeEmail     @UI.Hidden;
  employeeName      @title: 'Employee';
  department        @title: 'Department';
  employeeSite      @title: 'Site';
  country           @mandatory
                    @Common.ValueListWithFixedValues
                    @Common.ValueList: {
                      CollectionPath: 'Countries',
                      Parameters: [
                        { $Type: 'Common.ValueListParameterInOut',       LocalDataProperty: country, ValueListProperty: 'code' },
                        { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'description' }
                      ]
                    };
}

annotate ExpenseService.MyClaimItems with {
  ID      @UI.Hidden;
  vatType @Common.ValueListWithFixedValues
          @Common.ValueList: {
            CollectionPath: 'VATTypes',
            Parameters: [
              { $Type: 'Common.ValueListParameterInOut',       LocalDataProperty: vatType, ValueListProperty: 'code' },
              { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'description' }
            ]
          };
};

annotate ExpenseService.MyMileageClaims with { ID @UI.Hidden; };
