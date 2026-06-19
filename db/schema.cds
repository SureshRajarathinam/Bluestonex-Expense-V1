namespace com.bluestonex.expense;

using { managed, cuid } from '@sap/cds/common';

// ─── Code Lists ─────────────────────────────────────────────────────────────

entity ExpenseTypes {
  key code            : String(20);
      description     : String(100);
      requiresReceipt : Boolean default false;
}

entity VATTypes {
  key code        : String(10);
      description : String(50);
      rate        : Decimal(5, 4);
}

// ─── Master Data ─────────────────────────────────────────────────────────────

entity Employees : managed {
  key ID             : UUID;
      employeeNumber : String(20) @mandatory;
      fullName       : String(100) @mandatory;
      email          : String(255) @mandatory;
      site           : String(500);
      department     : String(100);
      payrollArea    : String(50);
      manager        : Association to Employees;
      financeEmail   : String(255) default 'Dan.Barton@bluestonex.com';
}

entity ExpensePolicy : managed {
  key ID              : UUID;
      policyName      : String(100);
      mileageRate     : Decimal(8, 4) default 0.2500;
      hotelDailyLimit : Decimal(10, 2);
      mealDailyLimit  : Decimal(10, 2);
      vatRate         : Decimal(5, 4) default 0.2000;
      effectiveFrom   : Date;
      effectiveTo     : Date;
}

// ─── Transactional ───────────────────────────────────────────────────────────

entity ExpenseClaims : managed {
  key ID                  : UUID;
      claimNumber         : String(20);
      employee            : Association to Employees @mandatory;
      payrollArea         : String(50);
      claimPeriod         : Date @mandatory;

      // Workflow status
      // Draft | Submitted | ManagerApproved | FinanceApproved | Settled | Rejected
      status              : String(30) default 'Draft';

      currency            : String(3) default 'GBP';
      totalNet            : Decimal(15, 2) default 0.00;
      totalVAT            : Decimal(15, 2) default 0.00;
      totalGross          : Decimal(15, 2) default 0.00;

      // Approval trail
      managerComment      : String(500);
      financeComment      : String(500);
      submittedAt         : DateTime;
      managerApprovedAt   : DateTime;
      managerApprovedBy   : String(255);
      financeApprovedAt   : DateTime;
      financeApprovedBy   : String(255);
      settledAt           : DateTime;

      items               : Composition of many ExpenseItems
                              on items.claim = $self;
      mileageClaims       : Composition of many MileageClaims
                              on mileageClaims.claim = $self;
}

entity ExpenseItems : managed {
  key ID              : UUID;
      claim           : Association to ExpenseClaims;
      expenseDate     : Date @mandatory;
      expenseType     : Association to ExpenseTypes @mandatory;
      destination     : String(255);
      reasonForTrip   : String(500) @mandatory;
      vatType         : String(10) default 'STD';  // STD | ZR | EX
      grossAmount     : Decimal(15, 2) @mandatory;
      netAmount       : Decimal(15, 2);
      vatAmount       : Decimal(15, 2);
      receiptAttached : Boolean default false;
      notes           : String(500);
}

entity MileageClaims : managed {
  key ID            : UUID;
      claim         : Association to ExpenseClaims;
      tripDate      : Date @mandatory;
      destination   : String(255) @mandatory;
      reasonForTrip : String(500) @mandatory;
      engineType    : String(20) default 'Petrol';  // Petrol | Diesel | Hybrid | Electric
      milesCount    : Decimal(10, 2) @mandatory;
      ratePerMile   : Decimal(8, 4) default 0.2500;
      totalAmount   : Decimal(15, 2);
}
