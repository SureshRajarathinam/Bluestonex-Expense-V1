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

// Business roles assignable to employees (governance; auth is enforced via XSUAA)
entity Roles {
  key code        : String(20);
      description : String(100);
}

// Countries the solution supports — drives tax (VAT/GST) and approval routing
entity Countries {
  key code        : String(2);   // UK | IN
      description : String(50);
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
      role           : String(20) default 'Employee';  // Employee | Manager | Finance | Admin
      active         : Boolean default true;
      manager        : Association to Employees;
      financeEmail   : String(255) default 'Dan.Barton@bluestonex.com';
}

// One policy row PER COUNTRY (UK | IN) — each country has its own rate and limits.
@assert.unique.country: [country]
entity ExpensePolicy : managed {
  key ID              : UUID;
      country         : String(2);   // UK | IN — the country this policy applies to
      policyName      : String(100);
      mileageRate      : Decimal(8, 4) default 0.2500;
      hotelDailyLimit  : Decimal(10, 2);
      mealDailyLimit   : Decimal(10, 2);
      receiptThreshold : Decimal(10, 2) default 25.00;  // receipt required at/above this gross amount
      vatRate          : Decimal(5, 4);  // UK VAT rate   (set on the UK row)
      gstRate          : Decimal(5, 4);  // India GST rate (set on the IN row)
      effectiveFrom   : Date;
      effectiveTo     : Date;
}

// Approval workflow members per country: UK = 2 levels, India = 1 level
entity ApprovalWorkflow : managed {
  key country        : String(2);    // UK | IN
      countryName    : String(50);
      firstApprover  : String(255);  // email of level-1 approver
      secondApprover : String(255);  // email of level-2 approver (UK only; null for India)
}

// ─── Transactional ───────────────────────────────────────────────────────────

entity ExpenseClaims : managed {
  key ID                  : UUID;
      claimNumber         : String(20);
      employee            : Association to Employees;  // auto-set from logged-in user
      country             : String(2);                 // UK | IN — set on Create; drives tax + routing
      payrollArea         : String(50);
      claimPeriod         : Date @mandatory;   // period start (Excel: Date Start)
      periodEnd           : Date;              // period end   (Excel: Date End)

      // Workflow status (country-driven):
      //   Draft → Submitted → FirstApproved (UK only) → Approved | Rejected
      status              : String(30) default 'Draft';

      currency            : String(3) default 'GBP';
      totalNet            : Decimal(15, 2) default 0.00;
      totalVAT            : Decimal(15, 2) default 0.00;  // holds VAT (UK) or GST (India)
      totalGross          : Decimal(15, 2) default 0.00;

      // Approval trail (generic, country-agnostic)
      submittedAt         : DateTime;
      level1ApprovedBy    : String(255);
      level1ApprovedAt    : DateTime;
      level1Comment       : String(500);
      level2ApprovedBy    : String(255);
      level2ApprovedAt    : DateTime;
      level2Comment       : String(500);
      rejectedBy          : String(255);
      rejectionReason     : String(500);

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

      // Receipt photo / document (per item) — SAP CAP media handling
      receiptFileName : String(255);
      receiptMimeType : String(100);
      receipt         : LargeBinary;
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

// ─── Governance: immutable audit trail ───────────────────────────────────────

entity AuditLog {
  key ID          : UUID;
      timestamp   : DateTime;
      userId      : String(255);
      action      : String(50);    // Submitted | ManagerApproved | FinanceApproved | Settled | Rejected | PolicyChanged | UserChanged
      objectType  : String(50);    // ExpenseClaim | ExpensePolicy | Employee
      objectKey   : String(50);    // claim number / policy name / employee number
      details     : String(1000);
}

// ─── Field labels & value helps (propagate to all service projections) ───────

annotate ExpenseClaims with {
  claimNumber       @title: 'Claim Number';
  country           @title: 'Country';
  claimPeriod       @title: 'Claim Period';
  payrollArea       @title: 'Payroll Area';
  status            @title: 'Status';
  currency          @title: 'Currency';
  totalNet          @title: 'Net Amount'   @Measures.ISOCurrency: currency;
  totalVAT          @title: 'Tax Amount'   @Measures.ISOCurrency: currency;
  totalGross        @title: 'Total Amount' @Measures.ISOCurrency: currency;
  submittedAt       @title: 'Submitted On';
  level1ApprovedBy  @title: 'Level 1 Approved By';
  level1ApprovedAt  @title: 'Level 1 Approved On';
  level1Comment     @title: 'Level 1 Comments';
  level2ApprovedBy  @title: 'Level 2 Approved By';
  level2ApprovedAt  @title: 'Level 2 Approved On';
  level2Comment     @title: 'Level 2 Comments';
  rejectedBy        @title: 'Rejected By';
  rejectionReason   @title: 'Rejection Reason';
}

annotate ExpenseItems with {
  expenseDate     @title: 'Date';
  destination     @title: 'Destination';
  reasonForTrip   @title: 'Reason for Trip';
  vatType         @title: 'Tax Type';
  grossAmount     @title: 'Gross Amount';
  netAmount       @title: 'Net Amount';
  vatAmount       @title: 'Tax Amount';
  receiptAttached @title: 'Receipt Attached';
  notes           @title: 'Notes';
  expenseType     @title: 'Expense Type'
                  @Common.Text: expenseType.description
                  @Common.TextArrangement: #TextOnly;

  // Media handling for the receipt photo/document
  receiptFileName @title: 'Receipt File';
  receiptMimeType @Core.IsMediaType;
  receipt         @title: 'Receipt'
                  @Core.MediaType            : receiptMimeType
                  @Core.ContentDisposition.Filename: receiptFileName
                  @Core.ContentDisposition.Type    : 'inline';
}

annotate MileageClaims with {
  tripDate      @title: 'Trip Date';
  destination   @title: 'Destination';
  reasonForTrip @title: 'Reason for Trip';
  engineType    @title: 'Engine Type';
  milesCount    @title: 'Miles Claimed';
  ratePerMile   @title: 'Rate per Mile (£)';
  totalAmount   @title: 'Total Amount (£)';
}
