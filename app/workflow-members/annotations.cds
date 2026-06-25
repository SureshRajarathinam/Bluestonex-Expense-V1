using ApprovalService from '../../srv/approval-service';

// ─── Approval Workflow Members — Admin App ───────────────────────────────────

annotate ApprovalService.WorkflowMembers with @(
  UI.HeaderInfo: {
    TypeName:       'Workflow',
    TypeNamePlural: 'Approval Workflow Members',
    Title:          { $Type: 'UI.DataField', Value: countryName },
    Description:    { $Type: 'UI.DataField', Value: country }
  },
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: countryName,    Label: 'Country',                ![@UI.Importance]: #High },
    { $Type: 'UI.DataField', Value: firstApprover,  Label: 'First-Level Approver',   ![@UI.Importance]: #High },
    { $Type: 'UI.DataField', Value: secondApprover, Label: 'Second-Level Approver',  ![@UI.Importance]: #High }
  ],
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: 'Approvers', ID: 'Approvers', Target: '@UI.FieldGroup#Approvers' }
  ],
  UI.FieldGroup #Approvers: {
    Data: [
      { $Type: 'UI.DataField', Value: country        },
      { $Type: 'UI.DataField', Value: countryName    },
      { $Type: 'UI.DataField', Value: firstApprover,  Label: 'First-Level Approver (email)'  },
      { $Type: 'UI.DataField', Value: secondApprover, Label: 'Second-Level Approver (email, UK only)' }
    ]
  }
);
