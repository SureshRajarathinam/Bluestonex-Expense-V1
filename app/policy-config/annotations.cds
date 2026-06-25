using ApprovalService from '../../srv/approval-service';

// ─── Policy Configuration — Admin App ────────────────────────────────────────

annotate ApprovalService.Policies with @(
  UI.HeaderInfo: {
    TypeName:       'Policy',
    TypeNamePlural: 'Policies',
    Title:          { $Type: 'UI.DataField', Value: policyName }
  },
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: policyName,       Label: 'Policy Name',          ![@UI.Importance]: #High },
    { $Type: 'UI.DataField', Value: vatRate,          Label: 'UK VAT Rate',          ![@UI.Importance]: #High },
    { $Type: 'UI.DataField', Value: gstRate,          Label: 'India GST Rate',       ![@UI.Importance]: #High },
    { $Type: 'UI.DataField', Value: mileageRate,      Label: 'Mileage Rate (£/mile)',![@UI.Importance]: #High },
    { $Type: 'UI.DataField', Value: receiptThreshold, Label: 'Receipt Threshold',    ![@UI.Importance]: #Medium }
  ],
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: 'Tax Rates',  ID: 'Tax',    Target: '@UI.FieldGroup#Tax' },
    { $Type: 'UI.ReferenceFacet', Label: 'Limits',     ID: 'Limits', Target: '@UI.FieldGroup#Limits' }
  ],
  UI.FieldGroup #Tax: {
    Data: [
      { $Type: 'UI.DataField', Value: policyName },
      { $Type: 'UI.DataField', Value: vatRate    },
      { $Type: 'UI.DataField', Value: gstRate    }
    ]
  },
  UI.FieldGroup #Limits: {
    Data: [
      { $Type: 'UI.DataField', Value: mileageRate      },
      { $Type: 'UI.DataField', Value: hotelDailyLimit  },
      { $Type: 'UI.DataField', Value: mealDailyLimit   },
      { $Type: 'UI.DataField', Value: receiptThreshold }
    ]
  }
);
