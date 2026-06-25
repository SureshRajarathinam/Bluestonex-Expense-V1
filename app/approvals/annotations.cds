using ApprovalService from '../../srv/approval-service';

// ─── Approvals — Approver App ────────────────────────────────────────────────

annotate ApprovalService.Approvals with @(

  UI.HeaderInfo: {
    TypeName:       'Expense Claim',
    TypeNamePlural: 'Approvals',
    Title:          { $Type: 'UI.DataField', Value: claimNumber },
    Description:    { $Type: 'UI.DataField', Value: employeeName }
  },

  UI.SelectionFields: [ status, country, claimPeriod ],

  UI.LineItem: [
    { $Type: 'UI.DataField', Value: claimNumber,  Label: 'Claim Number', ![@UI.Importance]: #High   },
    { $Type: 'UI.DataField', Value: employeeName, Label: 'Employee',     ![@UI.Importance]: #High   },
    { $Type: 'UI.DataField', Value: country,      Label: 'Country',      ![@UI.Importance]: #High   },
    { $Type: 'UI.DataField', Value: claimPeriod,  Label: 'Period',       ![@UI.Importance]: #Medium },
    { $Type: 'UI.DataField', Value: status,        Label: 'Status',
      Criticality: statusCriticality, CriticalityRepresentation: #WithIcon, ![@UI.Importance]: #High },
    { $Type: 'UI.DataField', Value: totalGross,    Label: 'Total',       ![@UI.Importance]: #High   },
    { $Type: 'UI.DataFieldForAction', Action: 'ApprovalService.approve', Label: 'Approve', Inline: true, ![@UI.Importance]: #High },
    { $Type: 'UI.DataFieldForAction', Action: 'ApprovalService.reject',  Label: 'Reject',  Inline: true, ![@UI.Importance]: #High }
  ],

  UI.Identification: [
    { $Type: 'UI.DataFieldForAction', Action: 'ApprovalService.approve', Label: 'Approve', ![@UI.Importance]: #High },
    { $Type: 'UI.DataFieldForAction', Action: 'ApprovalService.reject',  Label: 'Reject',  ![@UI.Importance]: #High }
  ],

  UI.DataPoint #TotalGross: { Value: totalGross, Title: 'Total Amount', ValueFormat: { NumberOfFractionalDigits: 2 } },
  UI.DataPoint #Status:     { Value: status, Title: 'Status', Criticality: statusCriticality },

  UI.HeaderFacets: [
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#TotalGross' },
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#Status'     }
  ],

  UI.Facets: [
    {
      $Type: 'UI.CollectionFacet', Label: 'Claim Details', ID: 'ClaimDetails',
      Facets: [
        { $Type: 'UI.ReferenceFacet', Label: 'Employee & Claim', ID: 'Emp', Target: '@UI.FieldGroup#Emp' },
        { $Type: 'UI.ReferenceFacet', Label: 'Amounts',          ID: 'Amt', Target: '@UI.FieldGroup#Amt' }
      ]
    },
    { $Type: 'UI.ReferenceFacet', Label: 'Expense Items',  ID: 'Items',   Target: 'items/@UI.LineItem' },
    { $Type: 'UI.ReferenceFacet', Label: 'Mileage Claims', ID: 'Mileage', Target: 'mileageClaims/@UI.LineItem' },
    { $Type: 'UI.ReferenceFacet', Label: 'Approval Trail', ID: 'Trail',   Target: '@UI.FieldGroup#Trail' }
  ],

  UI.FieldGroup #Emp: {
    Data: [
      { $Type: 'UI.DataField', Value: employeeName },
      { $Type: 'UI.DataField', Value: department   },
      { $Type: 'UI.DataField', Value: country      },
      { $Type: 'UI.DataField', Value: payrollArea  },
      { $Type: 'UI.DataField', Value: claimNumber  },
      { $Type: 'UI.DataField', Value: claimPeriod  },
      { $Type: 'UI.DataField', Value: submittedAt  }
    ]
  },
  UI.FieldGroup #Amt: {
    Data: [
      { $Type: 'UI.DataField', Value: currency   },
      { $Type: 'UI.DataField', Value: totalNet   },
      { $Type: 'UI.DataField', Value: totalVAT   },
      { $Type: 'UI.DataField', Value: totalGross }
    ]
  },
  UI.FieldGroup #Trail: {
    Data: [
      { $Type: 'UI.DataField', Value: status, Criticality: statusCriticality, CriticalityRepresentation: #WithIcon },
      { $Type: 'UI.DataField', Value: level1ApprovedBy },
      { $Type: 'UI.DataField', Value: level1ApprovedAt },
      { $Type: 'UI.DataField', Value: level1Comment    },
      { $Type: 'UI.DataField', Value: level2ApprovedBy },
      { $Type: 'UI.DataField', Value: level2ApprovedAt },
      { $Type: 'UI.DataField', Value: level2Comment    }
    ]
  }
);

annotate ApprovalService.ApprovalItems with @(
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: expenseDate,      Label: 'Date'        },
    { $Type: 'UI.DataField', Value: expenseType_code, Label: 'Type'        },
    { $Type: 'UI.DataField', Value: destination,      Label: 'Destination' },
    { $Type: 'UI.DataField', Value: reasonForTrip,    Label: 'Reason'      },
    { $Type: 'UI.DataField', Value: grossAmount,      Label: 'Gross'       },
    { $Type: 'UI.DataField', Value: netAmount,        Label: 'Net'         },
    { $Type: 'UI.DataField', Value: vatAmount,        Label: 'Tax'         },
    { $Type: 'UI.DataField', Value: receiptAttached,  Label: 'Receipt?'    },
    { $Type: 'UI.DataField', Value: receipt,          Label: 'View Receipt'}
  ]
);

annotate ApprovalService.ApprovalMileage with @(
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: tripDate,      Label: 'Trip Date'     },
    { $Type: 'UI.DataField', Value: destination,   Label: 'Destination'   },
    { $Type: 'UI.DataField', Value: reasonForTrip, Label: 'Reason'        },
    { $Type: 'UI.DataField', Value: engineType,    Label: 'Engine Type'   },
    { $Type: 'UI.DataField', Value: milesCount,    Label: 'Miles'         },
    { $Type: 'UI.DataField', Value: ratePerMile,   Label: 'Rate (£/mile)' },
    { $Type: 'UI.DataField', Value: totalAmount,   Label: 'Total'         }
  ]
);
