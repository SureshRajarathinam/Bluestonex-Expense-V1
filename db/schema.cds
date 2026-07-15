namespace EXP;

using { managed, cuid } from '@sap/cds/common';

// ─── Code Lists ─────────────────────────────────────────────────────────────

entity EXPENSE_TYPES {
  key code            : String(20);
      description     : String(100);
      requiresReceipt : Boolean default false;
}

// Country-aware tax-treatment list for the New Expense Claim item dropdown.
// One row per (country, code): Standard / Zero-rated / Exempt. Each row carries
// its own effective `rate` — this table is the SINGLE source of the tax rate:
// STD holds the country standard rate (UK 0.20 / IN 0.18), Zero-rated/Exempt = 0.
// calc.splitVAT resolves the rate from the item's chosen tax type. (ExpensePolicy
// no longer holds vatRate/gstRate.) Composite key lets UK and India each define
// their own STD/ZR/EX with independent rates.
entity TAX_TYPES {
  key country     : String(2);        // UK | IN
  key code        : String(10);       // STD | ZR | EX
      description : String(50);
      rate        : Decimal(5, 4);    // effective rate for this treatment (STD>0, ZR/EX=0)
}

// Countries the solution supports — drives tax (VAT/GST) and approval routing
entity COUNTRIES {
  key code        : String(2);   // UK | IN
      description : String(50);
}

// ─── Master Data ─────────────────────────────────────────────────────────────

// Employee master — an EXACT MIRROR of the classic USERS_MASTER table.
// Column names/order match USERS_MASTER 1:1, so db/data/EXP-EMPLOYEES.csv (a copy
// of Master_User_BSX.csv) imports directly on deploy. There is NO runtime
// dependency on the external USERS_MASTER container — this table IS the master.
//   • ID          — source BIGINT primary key (also the FK target for CLAIMS.employee)
//   • Email       — join key to the logged-in $user (matched case-insensitively)
//   • FName/LName — display name is FName + ' ' + LName (see service projections)
//   • EmpID       — business employee number · BaseSiteKey — site code · IsActive — 'Y'/'N'
entity EMPLOYEES {
  key ID          : Integer64;      // USERS_MASTER.ID (BIGINT PK)
      UserID      : String(50);
      OrgID       : String(10);
      FName       : String(100);
      LName       : String(100);
      Email       : String(255);
      Mobile      : String(30);
      EmpID       : String(50);
      UserTypeKey : String(10);     // S | C
      BaseSiteKey : String(50);     // UKOSW | INAUG | PLRMT | Apphaus
      ManagerID   : String(50);
      Pic         : LargeString;    // base64 data-URI photo
      PicB        : LargeString;
      IsActive    : String(1);      // Y | N
      TargetUtilization : Integer;
      TargetHrsPerWeek  : String(10);   // e.g. '40:00'
      BonusPercent      : Integer;
      PensionRate       : Integer;
}

// One policy row PER COUNTRY (UK | IN) — each country has its own rate and limits.
@assert.unique.country: [country]
entity POLICY : managed {
  key ID              : UUID;
      country         : String(2);   // UK | IN — the country this policy applies to
      policyName      : String(100);
      mileageRate      : Decimal(8, 4) default 0.2500;
      hotelDailyLimit  : Decimal(10, 2);
      mealDailyLimit   : Decimal(10, 2);
      receiptThreshold : Decimal(10, 2) default 25.00;  // receipt required at/above this gross amount
      // Tax rate is NOT held here — it lives per treatment on TAX_TYPES (the tax
      // type dropdown drives the rate). Policy owns limits + the claim-number seed.
      // Starting Claim Number for this country (e.g. 'UKEXP1' / 'INEXP1'). The
      // trailing digits seed the sequence; new claims for the country take this
      // value first, then increment (UKEXP1, UKEXP2, …). Maintained per country
      // in Policy Configuration.
      claimNumberStart : String(20);
      effectiveFrom   : Date;
      effectiveTo     : Date;
}

// Approval workflow members per country: UK = 2 levels, India = 1 level
entity WORKFLOW : managed {
  key country        : String(2);    // UK | IN
      countryName    : String(50);
      firstApprover  : String(255);  // email of level-1 approver
      secondApprover : String(255);  // email of level-2 approver (UK only; null for India)
}

// ─── Transactional ───────────────────────────────────────────────────────────

@assert.unique.claimNumber: [claimNumber]   // no two claims share a number (fix D2)
entity CLAIMS : managed {
  key ID                  : UUID;
      claimNumber         : String(20);
      employee            : Association to EMPLOYEES;  // auto-set from logged-in user
      country             : String(2);                 // UK | IN — set on Create; drives tax + routing
      payrollArea         : String(50);
      claimPeriod         : Date @mandatory;   // period start (Excel: Date Start)
      periodEnd           : Date;              // period end   (Excel: Date End)

      // Workflow status (country-driven):
      //   Draft → Submitted → FirstApproved (UK only) → Approved
      //                    ↘ Returned (declined — reworkable) → Submitted (Resubmitted) → …
      //   'Rejected' is a legacy/terminal value (kept for old data & labels; not
      //   produced by the current decline flow, which returns for rework instead).
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
      // Soft policy flags raised at submit (e.g. daily meal/hotel limit breaches).
      // NON-blocking: the claim still submits; the approver sees these and decides.
      // Set on each submit, cleared (null) when the resubmitted claim is clean.
      policyFlags         : String(1000);

      items               : Composition of many ITEMS
                              on items.claim = $self;
      mileageClaims       : Composition of many MILEAGE
                              on mileageClaims.claim = $self;
}

entity ITEMS : managed {
  key ID              : UUID;
      claim           : Association to CLAIMS;
      expenseDate     : Date @mandatory;
      expenseType     : Association to EXPENSE_TYPES @mandatory;
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

entity MILEAGE : managed {
  key ID            : UUID;
      claim         : Association to CLAIMS;
      tripDate      : Date @mandatory;
      destination   : String(255) @mandatory;
      reasonForTrip : String(500) @mandatory;
      engineType    : String(20) default 'Petrol';  // Petrol | Diesel | Hybrid | Electric
      milesCount    : Decimal(10, 2) @mandatory;
      ratePerMile   : Decimal(8, 4) default 0.2500;
      totalAmount   : Decimal(15, 2);
}

// ─── Governance: immutable audit trail ───────────────────────────────────────

entity AUDITLOG {
  key ID          : UUID;
      timestamp   : DateTime;
      userId      : String(255);
      action      : String(50);    // Submitted | Resubmitted | FirstApproved | Approved | Returned | Rejected(legacy) | PolicyChanged | WorkflowChanged
      objectType  : String(50);    // ExpenseClaim | ExpensePolicy | Employee
      objectKey   : String(50);    // claim number / policy name / employee number
      details     : String(1000);
}

// ─── Field labels & value helps (propagate to all service projections) ───────

annotate CLAIMS with {
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

annotate ITEMS with {
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

annotate MILEAGE with {
  tripDate      @title: 'Trip Date';
  destination   @title: 'Destination';
  reasonForTrip @title: 'Reason for Trip';
  engineType    @title: 'Engine Type';
  milesCount    @title: 'Miles Claimed';
  ratePerMile   @title: 'Rate per Mile (£)';
  totalAmount   @title: 'Total Amount (£)';
}

// ─── D1 concurrency note ─────────────────────────────────────────────────────
// A blanket @odata.etag was evaluated and REVERTED: all mutable entities here
// are draft-enabled, and enabling ETag makes CAP require If-Match on
// draftActivate/bound actions (428), which the freestyle callAction does not
// send — it breaks the whole draft flow. Concurrency is instead handled by CAP
// DRAFT LOCKS (a 2nd concurrent draftEdit → 409, see test CON-03) plus
// STATUS-GUARDED actions (approve/reject re-check status → 409). A full ETag
// rollout requires wiring If-Match through the UI's callAction (deferred).
