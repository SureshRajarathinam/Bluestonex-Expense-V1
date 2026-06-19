using FinanceService from '../../srv/finance-service';

// ─── Finance Expenses — Finance App ─────────────────────────────────────────

annotate FinanceService.FinanceClaims with @(

  UI.HeaderInfo: {
    TypeName:       'Expense Claim',
    TypeNamePlural: 'Finance Expense Claims',
    Title:          { $Type: 'UI.DataField', Value: claimNumber },
    Description:    { $Type: 'UI.DataField', Value: employeeName }
  },

  UI.SelectionFields: [ status, payrollArea, claimPeriod ],

  UI.LineItem: [
    { $Type: 'UI.DataField', Value: claimNumber,      Label: 'Claim Number'      },
    { $Type: 'UI.DataField', Value: employeeName,     Label: 'Employee'          },
    { $Type: 'UI.DataField', Value: payrollArea,      Label: 'Payroll Area'      },
    { $Type: 'UI.DataField', Value: claimPeriod,      Label: 'Period'            },
    { $Type: 'UI.DataField', Value: status,            Label: 'Status',
      Criticality: statusCriticality,
      CriticalityRepresentation: #WithIcon                                        },
    { $Type: 'UI.DataField', Value: totalGross,        Label: 'Total (£)'        },
    { $Type: 'UI.DataField', Value: managerApprovedAt, Label: 'Mgr Approved On'  },
    {
      $Type:  'UI.DataFieldForAction',
      Action: 'FinanceService.financeApprove',
      Label:  'Finance Approve',
      Inline: true,
      ![@UI.Importance]: #High
    },
    {
      $Type:  'UI.DataFieldForAction',
      Action: 'FinanceService.settleClaim',
      Label:  'Settle',
      Inline: true,
      ![@UI.Importance]: #High
    },
    {
      $Type:  'UI.DataFieldForAction',
      Action: 'FinanceService.rejectClaim',
      Label:  'Reject',
      Inline: true,
      ![@UI.Importance]: #Medium
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
      $Type:  'UI.CollectionFacet',
      Label:  'Approval Trail',
      ID:     'ApprovalTrail',
      Facets: [
        {
          $Type:  'UI.ReferenceFacet',
          Label:  'Manager Approval',
          ID:     'ManagerApproval',
          Target: '@UI.FieldGroup#ManagerApproval'
        },
        {
          $Type:  'UI.ReferenceFacet',
          Label:  'Finance Approval',
          ID:     'FinanceApproval',
          Target: '@UI.FieldGroup#FinanceApproval'
        }
      ]
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

  UI.FieldGroup #ManagerApproval: {
    Data: [
      { $Type: 'UI.DataField', Value: managerApprovedBy },
      { $Type: 'UI.DataField', Value: managerApprovedAt },
      { $Type: 'UI.DataField', Value: managerComment    }
    ]
  },

  UI.FieldGroup #FinanceApproval: {
    Data: [
      { $Type: 'UI.DataField', Value: status,
        Criticality: statusCriticality,
        CriticalityRepresentation: #WithIcon  },
      { $Type: 'UI.DataField', Value: financeApprovedBy },
      { $Type: 'UI.DataField', Value: financeApprovedAt },
      { $Type: 'UI.DataField', Value: financeComment    },
      { $Type: 'UI.DataField', Value: settledAt         }
    ]
  }
);

annotate FinanceService.FinanceClaimItems with @(
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

annotate FinanceService.FinanceMileageClaims with @(
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
