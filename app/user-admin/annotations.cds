using AdminService from '../../srv/admin-service';

// ─── User & Role Management ──────────────────────────────────────────────────

annotate AdminService.Users with @(
  UI.HeaderInfo: {
    TypeName:       'User',
    TypeNamePlural: 'Users',
    Title:          { $Type: 'UI.DataField', Value: fullName },
    Description:    { $Type: 'UI.DataField', Value: role }
  },

  UI.SelectionFields: [ role, department, active ],

  UI.LineItem: [
    { $Type: 'UI.DataField', Value: employeeNumber, Label: 'Emp. No.',   ![@UI.Importance]: #High   },
    { $Type: 'UI.DataField', Value: fullName,       Label: 'Full Name',  ![@UI.Importance]: #High   },
    { $Type: 'UI.DataField', Value: email,          Label: 'Email',      ![@UI.Importance]: #High   },
    { $Type: 'UI.DataField', Value: department,     Label: 'Department', ![@UI.Importance]: #Medium },
    { $Type: 'UI.DataField', Value: role,           Label: 'Role',       ![@UI.Importance]: #High   },
    { $Type: 'UI.DataField', Value: active,         Label: 'Active',     ![@UI.Importance]: #Medium }
  ],

  UI.Facets: [
    {
      $Type:  'UI.ReferenceFacet',
      Label:  'User Details',
      ID:     'UserDetails',
      Target: '@UI.FieldGroup#UserDetails'
    }
  ],

  UI.FieldGroup #UserDetails: {
    Data: [
      { $Type: 'UI.DataField', Value: employeeNumber },
      { $Type: 'UI.DataField', Value: fullName       },
      { $Type: 'UI.DataField', Value: email          },
      { $Type: 'UI.DataField', Value: department     },
      { $Type: 'UI.DataField', Value: site           },
      { $Type: 'UI.DataField', Value: payrollArea    },
      { $Type: 'UI.DataField', Value: role           },
      { $Type: 'UI.DataField', Value: active         },
      { $Type: 'UI.DataField', Value: financeEmail   }
    ]
  }
);
