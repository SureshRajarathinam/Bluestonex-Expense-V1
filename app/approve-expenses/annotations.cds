using ExpenseService from '../../srv/expense-service';

// ─── Approve Expenses — Manager App ─────────────────────────────────────────

annotate ExpenseService.TeamClaims with @(

  UI.HeaderInfo: {
    TypeName:       'Expense Claim',
    TypeNamePlural: 'Team Expense Claims',
    Title:          { $Type: 'UI.DataField', Value: claimNumber },
    Description:    { $Type: 'UI.DataField', Value: employeeName }
  },

  UI.SelectionFields: [ status, claimPeriod, department ],

  UI.LineItem: [
    { $Type: 'UI.DataField', Value: claimNumber,  Label: 'Claim Number'   },
    { $Type: 'UI.DataField', Value: employeeName, Label: 'Employee'       },
    { $Type: 'UI.DataField', Value: department,   Label: 'Department'     },
    { $Type: 'UI.DataField', Value: claimPeriod,  Label: 'Period'         },
    { $Type: 'UI.DataField', Value: status,        Label: 'Status',
      Criticality: statusCriticality,
      CriticalityRepresentation: #WithIcon                                 },
    { $Type: 'UI.DataField', Value: totalGross,    Label: 'Total (£)'     },
    { $Type: 'UI.DataField', Value: submittedAt,   Label: 'Submitted On'  },
    {
      $Type:  'UI.DataFieldForAction',
      Action: 'ExpenseService.approveClaim',
      Label:  'Approve',
      Inline: true,
      ![@UI.Importance]: #High
    },
    {
      $Type:  'UI.DataFieldForAction',
      Action: 'ExpenseService.rejectClaim',
      Label:  'Reject',
      Inline: true,
      ![@UI.Importance]: #High
    }
  ],

  UI.DataPoint #TotalGross: {
    Value:       totalGross,
    Title:       'Total Amount',
    ValueFormat: { NumberOfFractionalDigits: 2 }
  },

  UI.DataPoint #Status: {
    Value:       status,
    Title:       'Status',
    Criticality: statusCriticality
  },

  UI.HeaderFacets: [
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#TotalGross' },
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#Status'     }
  ],

  UI.Facets: [
    {
      $Type:  'UI.CollectionFacet',
      Label:  'Claim Details',
      ID:     'ClaimDetails',
      Facets: [
        {
          $Type:  'UI.ReferenceFacet',
          Label:  'Employee & Claim',
          ID:     'EmployeeInfo',
          Target: '@UI.FieldGroup#EmployeeInfo'
        },
        {
          $Type:  'UI.ReferenceFacet',
          Label:  'Amounts',
          ID:     'Amounts',
          Target: '@UI.FieldGroup#Amounts'
        }
      ]
    },
    {
      $Type:  'UI.ReferenceFacet',
      Label:  'Expense Items',
      ID:     'ExpenseItems',
      Target: 'items/@UI.LineItem'
    },
    {
      $Type:  'UI.ReferenceFacet',
      Label:  'Mileage Claims',
      ID:     'MileageClaims',
      Target: 'mileageClaims/@UI.LineItem'
    },
    {
      $Type:  'UI.ReferenceFacet',
      Label:  'Manager Decision',
      ID:     'ManagerDecision',
      Target: '@UI.FieldGroup#ManagerDecision'
    }
  ],

  UI.FieldGroup #EmployeeInfo: {
    Data: [
      { $Type: 'UI.DataField', Value: employeeName  },
      { $Type: 'UI.DataField', Value: department    },
      { $Type: 'UI.DataField', Value: employeeSite  },
      { $Type: 'UI.DataField', Value: payrollArea   },
      { $Type: 'UI.DataField', Value: claimNumber   },
      { $Type: 'UI.DataField', Value: claimPeriod   },
      { $Type: 'UI.DataField', Value: submittedAt   }
    ]
  },

  UI.FieldGroup #Amounts: {
    Data: [
      { $Type: 'UI.DataField', Value: currency   },
      { $Type: 'UI.DataField', Value: totalNet   },
      { $Type: 'UI.DataField', Value: totalVAT   },
      { $Type: 'UI.DataField', Value: totalGross }
    ]
  },

  UI.FieldGroup #ManagerDecision: {
    Data: [
      { $Type: 'UI.DataField', Value: status,
        Criticality: statusCriticality,
        CriticalityRepresentation: #WithIcon },
      { $Type: 'UI.DataField', Value: managerComment    },
      { $Type: 'UI.DataField', Value: managerApprovedAt },
      { $Type: 'UI.DataField', Value: managerApprovedBy }
    ]
  }
);

annotate ExpenseService.TeamClaimItems with @(
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: expenseDate,      Label: 'Date'       },
    { $Type: 'UI.DataField', Value: expenseType_code, Label: 'Type'       },
    { $Type: 'UI.DataField', Value: destination,      Label: 'Destination'},
    { $Type: 'UI.DataField', Value: reasonForTrip,    Label: 'Reason'     },
    { $Type: 'UI.DataField', Value: vatType,          Label: 'VAT'        },
    { $Type: 'UI.DataField', Value: grossAmount,      Label: 'Gross (£)'  },
    { $Type: 'UI.DataField', Value: netAmount,        Label: 'Net (£)'    },
    { $Type: 'UI.DataField', Value: vatAmount,        Label: 'VAT (£)'    },
    { $Type: 'UI.DataField', Value: receiptAttached,  Label: 'Receipt'    }
  ]
);

annotate ExpenseService.TeamMileageClaims with @(
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: tripDate,      Label: 'Trip Date'     },
    { $Type: 'UI.DataField', Value: destination,   Label: 'Destination'   },
    { $Type: 'UI.DataField', Value: reasonForTrip, Label: 'Reason'        },
    { $Type: 'UI.DataField', Value: engineType,    Label: 'Engine Type'   },
    { $Type: 'UI.DataField', Value: milesCount,    Label: 'Miles'         },
    { $Type: 'UI.DataField', Value: ratePerMile,   Label: 'Rate (£/mile)' },
    { $Type: 'UI.DataField', Value: totalAmount,   Label: 'Total (£)'     }
  ]
);
