using AdminService from '../../srv/admin-service';

// ─── Audit Log (read-only) ───────────────────────────────────────────────────

annotate AdminService.AuditLogs with @(
  UI.HeaderInfo: {
    TypeName:       'Audit Entry',
    TypeNamePlural: 'Audit Log',
    Title:          { $Type: 'UI.DataField', Value: action },
    Description:    { $Type: 'UI.DataField', Value: objectKey }
  },

  UI.SelectionFields: [ action, objectType, userId ],

  UI.LineItem: [
    { $Type: 'UI.DataField', Value: timestamp,  Label: 'Timestamp',   ![@UI.Importance]: #High   },
    { $Type: 'UI.DataField', Value: action,     Label: 'Action',      ![@UI.Importance]: #High   },
    { $Type: 'UI.DataField', Value: objectType, Label: 'Object Type', ![@UI.Importance]: #Medium },
    { $Type: 'UI.DataField', Value: objectKey,  Label: 'Reference',   ![@UI.Importance]: #High   },
    { $Type: 'UI.DataField', Value: userId,     Label: 'User',        ![@UI.Importance]: #Medium },
    { $Type: 'UI.DataField', Value: details,    Label: 'Details',     ![@UI.Importance]: #Low    }
  ],

  UI.Facets: [
    {
      $Type:  'UI.ReferenceFacet',
      Label:  'Audit Entry',
      ID:     'AuditEntry',
      Target: '@UI.FieldGroup#AuditEntry'
    }
  ],

  UI.FieldGroup #AuditEntry: {
    Data: [
      { $Type: 'UI.DataField', Value: timestamp  },
      { $Type: 'UI.DataField', Value: action     },
      { $Type: 'UI.DataField', Value: objectType },
      { $Type: 'UI.DataField', Value: objectKey  },
      { $Type: 'UI.DataField', Value: userId     },
      { $Type: 'UI.DataField', Value: details    }
    ]
  }
);
