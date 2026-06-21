using AdminService from '../../srv/admin-service';

// ─── System Health Metrics (read-only) ───────────────────────────────────────

annotate AdminService.SystemHealth with @(
  UI.HeaderInfo: {
    TypeName:       'Status Metric',
    TypeNamePlural: 'Claims by Status'
  },

  UI.LineItem: [
    { $Type: 'UI.DataField', Value: status,      Label: 'Status',           ![@UI.Importance]: #High },
    { $Type: 'UI.DataField', Value: claimCount,  Label: 'Number of Claims', ![@UI.Importance]: #High },
    { $Type: 'UI.DataField', Value: totalAmount, Label: 'Total Amount (£)', ![@UI.Importance]: #High }
  ]
);
