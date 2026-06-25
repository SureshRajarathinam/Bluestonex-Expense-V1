using ExpenseService from '../../srv/expense-service';

// ─── My Expenses — Employee App ──────────────────────────────────────────────

annotate ExpenseService.MyClaims with @(

  UI.HeaderInfo: {
    TypeName:       'Expense Claim',
    TypeNamePlural: 'Expense Claims',
    Title:          { $Type: 'UI.DataField', Value: claimNumber },
    Description:    { $Type: 'UI.DataField', Value: status }
  },

  UI.SelectionFields: [ status, country, claimPeriod ],

  UI.LineItem: [
    { $Type: 'UI.DataField', Value: claimNumber, Label: 'Claim Number', ![@UI.Importance]: #High   },
    { $Type: 'UI.DataField', Value: country,     Label: 'Country',       ![@UI.Importance]: #High   },
    { $Type: 'UI.DataField', Value: claimPeriod, Label: 'Period',        ![@UI.Importance]: #Medium },
    { $Type: 'UI.DataField', Value: status,       Label: 'Status',
      Criticality: statusCriticality,
      CriticalityRepresentation: #WithIcon,
      ![@UI.Importance]: #High                                                                      },
    { $Type: 'UI.DataField', Value: totalGross,   Label: 'Total',        ![@UI.Importance]: #High   },
    { $Type: 'UI.DataField', Value: submittedAt,  Label: 'Submitted On', ![@UI.Importance]: #Low    },
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
        { $Type: 'UI.ReferenceFacet', Label: 'General Information', ID: 'GeneralInfo', Target: '@UI.FieldGroup#GeneralInfo' },
        { $Type: 'UI.ReferenceFacet', Label: 'Amounts',            ID: 'Amounts',     Target: '@UI.FieldGroup#Amounts' }
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
      { $Type: 'UI.DataField', Value: country        },
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
      { $Type: 'UI.DataField', Value: submittedAt      },
      { $Type: 'UI.DataField', Value: level1ApprovedBy },
      { $Type: 'UI.DataField', Value: level1ApprovedAt },
      { $Type: 'UI.DataField', Value: level1Comment    },
      { $Type: 'UI.DataField', Value: level2ApprovedBy },
      { $Type: 'UI.DataField', Value: level2ApprovedAt },
      { $Type: 'UI.DataField', Value: level2Comment    },
      { $Type: 'UI.DataField', Value: rejectedBy       },
      { $Type: 'UI.DataField', Value: rejectionReason  }
    ]
  }
);

// ─── Expense Items: INLINE on the claim page (no sub-page), with attachment ──
annotate ExpenseService.MyClaimItems with @(
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: expenseDate,      Label: 'Date'        },
    { $Type: 'UI.DataField', Value: expenseType_code, Label: 'Type'        },
    { $Type: 'UI.DataField', Value: destination,      Label: 'Destination' },
    { $Type: 'UI.DataField', Value: reasonForTrip,    Label: 'Reason'      },
    { $Type: 'UI.DataField', Value: vatType,          Label: 'Tax Type'    },
    { $Type: 'UI.DataField', Value: grossAmount,      Label: 'Gross'       },
    { $Type: 'UI.DataField', Value: netAmount,        Label: 'Net'         },
    { $Type: 'UI.DataField', Value: vatAmount,        Label: 'Tax'         },
    { $Type: 'UI.DataField', Value: receipt,          Label: 'Attachment'  }
  ]
);

// ─── Mileage Claims: INLINE on the claim page ────────────────────────────────
annotate ExpenseService.MyMileageClaims with @(
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: tripDate,      Label: 'Trip Date'      },
    { $Type: 'UI.DataField', Value: destination,   Label: 'Destination'    },
    { $Type: 'UI.DataField', Value: reasonForTrip, Label: 'Reason'         },
    { $Type: 'UI.DataField', Value: engineType,    Label: 'Engine Type'    },
    { $Type: 'UI.DataField', Value: milesCount,    Label: 'Miles'          },
    { $Type: 'UI.DataField', Value: ratePerMile,   Label: 'Rate (£/mile)'  },
    { $Type: 'UI.DataField', Value: totalAmount,   Label: 'Total'          }
  ]
);
