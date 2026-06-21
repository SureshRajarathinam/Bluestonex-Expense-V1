using ExpenseService from '../../srv/expense-service';

// ─── My Expenses — Employee App ──────────────────────────────────────────────

annotate ExpenseService.MyClaims with @(

  UI.HeaderInfo: {
    TypeName:       'Expense Claim',
    TypeNamePlural: 'Expense Claims',
    Title:          { $Type: 'UI.DataField', Value: claimNumber },
    Description:    { $Type: 'UI.DataField', Value: status }
  },

  UI.SelectionFields: [ status, claimPeriod ],

  UI.LineItem: [
    { $Type: 'UI.DataField', Value: claimNumber, Label: 'Claim Number', ![@UI.Importance]: #High   },
    { $Type: 'UI.DataField', Value: claimPeriod, Label: 'Period',       ![@UI.Importance]: #Medium },
    { $Type: 'UI.DataField', Value: status,       Label: 'Status',
      Criticality: statusCriticality,
      CriticalityRepresentation: #WithIcon,
      ![@UI.Importance]: #High                                                                      },
    { $Type: 'UI.DataField', Value: totalGross,   Label: 'Total (£)',   ![@UI.Importance]: #High   },
    { $Type: 'UI.DataField', Value: submittedAt,  Label: 'Submitted On',![@UI.Importance]: #Low    },
    {
      $Type:  'UI.DataFieldForAction',
      Action: 'ExpenseService.submitClaim',
      Label:  'Apply for Approval',
      ![@UI.Importance]: #High
    }
  ],

  // Object Page header action — the "Apply" button (only enabled while Draft)
  UI.Identification: [
    {
      $Type:  'UI.DataFieldForAction',
      Action: 'ExpenseService.submitClaim',
      Label:  'Apply for Approval',
      ![@UI.Importance]: #High
    }
  ],

  UI.DataPoint #TotalGross: {
    Value:        totalGross,
    Title:        'Total Amount',
    ValueFormat:  { NumberOfFractionalDigits: 2 }
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
          Label:  'General Information',
          ID:     'GeneralInfo',
          Target: '@UI.FieldGroup#GeneralInfo'
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
      Label:  'Approval Information',
      ID:     'ApprovalInfo',
      Target: '@UI.FieldGroup#ApprovalInfo'
    }
  ],

  UI.FieldGroup #GeneralInfo: {
    Data: [
      { $Type: 'UI.DataField', Value: claimNumber   },
      { $Type: 'UI.DataField', Value: claimPeriod   },
      { $Type: 'UI.DataField', Value: payrollArea   },
      { $Type: 'UI.DataField', Value: employeeName  },
      { $Type: 'UI.DataField', Value: department    },
      { $Type: 'UI.DataField', Value: employeeSite  }
    ]
  },

  UI.FieldGroup #Amounts: {
    Data: [
      { $Type: 'UI.DataField', Value: currency    },
      { $Type: 'UI.DataField', Value: totalNet    },
      { $Type: 'UI.DataField', Value: totalVAT    },
      { $Type: 'UI.DataField', Value: totalGross  }
    ]
  },

  UI.FieldGroup #ApprovalInfo: {
    Data: [
      { $Type: 'UI.DataField', Value: submittedAt       },
      { $Type: 'UI.DataField', Value: managerApprovedAt },
      { $Type: 'UI.DataField', Value: managerApprovedBy },
      { $Type: 'UI.DataField', Value: managerComment    },
      { $Type: 'UI.DataField', Value: financeApprovedAt },
      { $Type: 'UI.DataField', Value: financeApprovedBy },
      { $Type: 'UI.DataField', Value: financeComment    },
      { $Type: 'UI.DataField', Value: settledAt         }
    ]
  }
);

// ─── Expense Items: table + item Object Page with receipt upload ─────────────

annotate ExpenseService.MyClaimItems with @(
  UI.HeaderInfo: {
    TypeName:       'Expense Item',
    TypeNamePlural: 'Expense Items',
    Title:          { $Type: 'UI.DataField', Value: expenseType_code },
    Description:    { $Type: 'UI.DataField', Value: reasonForTrip }
  },

  UI.LineItem: [
    { $Type: 'UI.DataField', Value: expenseDate,      Label: 'Date'        },
    { $Type: 'UI.DataField', Value: expenseType_code, Label: 'Type'        },
    { $Type: 'UI.DataField', Value: destination,      Label: 'Destination' },
    { $Type: 'UI.DataField', Value: reasonForTrip,    Label: 'Reason'      },
    { $Type: 'UI.DataField', Value: vatType,          Label: 'VAT'         },
    { $Type: 'UI.DataField', Value: grossAmount,      Label: 'Gross (£)'   },
    { $Type: 'UI.DataField', Value: netAmount,        Label: 'Net (£)'     },
    { $Type: 'UI.DataField', Value: vatAmount,        Label: 'VAT (£)'     },
    { $Type: 'UI.DataField', Value: receiptAttached,  Label: 'Receipt'     }
  ],

  UI.Facets: [
    {
      $Type:  'UI.ReferenceFacet',
      Label:  'Item Details',
      ID:     'ItemDetails',
      Target: '@UI.FieldGroup#ItemDetails'
    },
    {
      $Type:  'UI.ReferenceFacet',
      Label:  'Receipt',
      ID:     'ReceiptFacet',
      Target: '@UI.FieldGroup#Receipt'
    }
  ],

  UI.FieldGroup #ItemDetails: {
    Data: [
      { $Type: 'UI.DataField', Value: expenseDate      },
      { $Type: 'UI.DataField', Value: expenseType_code },
      { $Type: 'UI.DataField', Value: destination      },
      { $Type: 'UI.DataField', Value: reasonForTrip    },
      { $Type: 'UI.DataField', Value: vatType          },
      { $Type: 'UI.DataField', Value: grossAmount      },
      { $Type: 'UI.DataField', Value: netAmount        },
      { $Type: 'UI.DataField', Value: vatAmount        },
      { $Type: 'UI.DataField', Value: notes            }
    ]
  },

  UI.FieldGroup #Receipt: {
    Data: [
      { $Type: 'UI.DataField', Value: receipt          },
      { $Type: 'UI.DataField', Value: receiptAttached  }
    ]
  }
);

// ─── Mileage Claims table on Object Page ─────────────────────────────────────

annotate ExpenseService.MyMileageClaims with @(
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: tripDate,      Label: 'Trip Date'      },
    { $Type: 'UI.DataField', Value: destination,   Label: 'Destination'    },
    { $Type: 'UI.DataField', Value: reasonForTrip, Label: 'Reason'         },
    { $Type: 'UI.DataField', Value: engineType,    Label: 'Engine Type'    },
    { $Type: 'UI.DataField', Value: milesCount,    Label: 'Miles'          },
    { $Type: 'UI.DataField', Value: ratePerMile,   Label: 'Rate (£/mile)'  },
    { $Type: 'UI.DataField', Value: totalAmount,   Label: 'Total (£)'      }
  ]
);
