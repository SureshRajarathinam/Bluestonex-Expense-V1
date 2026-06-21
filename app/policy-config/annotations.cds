using AdminService from '../../srv/admin-service';

// ─── Policy Configuration ────────────────────────────────────────────────────

annotate AdminService.Policies with @(
  UI.HeaderInfo: {
    TypeName:       'Expense Policy',
    TypeNamePlural: 'Expense Policies',
    Title:          { $Type: 'UI.DataField', Value: policyName },
    Description:    { $Type: 'UI.DataField', Value: effectiveFrom }
  },

  UI.LineItem: [
    { $Type: 'UI.DataField', Value: policyName,       Label: 'Policy',                ![@UI.Importance]: #High   },
    { $Type: 'UI.DataField', Value: mileageRate,      Label: 'Mileage Rate (£/mile)', ![@UI.Importance]: #High   },
    { $Type: 'UI.DataField', Value: hotelDailyLimit,  Label: 'Hotel Limit (£/day)',   ![@UI.Importance]: #High   },
    { $Type: 'UI.DataField', Value: mealDailyLimit,   Label: 'Meal Limit (£/day)',    ![@UI.Importance]: #Medium },
    { $Type: 'UI.DataField', Value: receiptThreshold, Label: 'Receipt Threshold (£)', ![@UI.Importance]: #Medium },
    { $Type: 'UI.DataField', Value: effectiveFrom,    Label: 'Effective From',        ![@UI.Importance]: #Low    }
  ],

  UI.Facets: [
    {
      $Type:  'UI.ReferenceFacet',
      Label:  'Policy Settings',
      ID:     'PolicySettings',
      Target: '@UI.FieldGroup#PolicySettings'
    },
    {
      $Type:  'UI.ReferenceFacet',
      Label:  'Validity',
      ID:     'Validity',
      Target: '@UI.FieldGroup#Validity'
    }
  ],

  UI.FieldGroup #PolicySettings: {
    Data: [
      { $Type: 'UI.DataField', Value: policyName       },
      { $Type: 'UI.DataField', Value: mileageRate      },
      { $Type: 'UI.DataField', Value: hotelDailyLimit  },
      { $Type: 'UI.DataField', Value: mealDailyLimit   },
      { $Type: 'UI.DataField', Value: receiptThreshold },
      { $Type: 'UI.DataField', Value: vatRate          }
    ]
  },

  UI.FieldGroup #Validity: {
    Data: [
      { $Type: 'UI.DataField', Value: effectiveFrom },
      { $Type: 'UI.DataField', Value: effectiveTo   }
    ]
  }
);
