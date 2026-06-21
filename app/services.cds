// Aggregates the Fiori UI annotations so cds watch / cds build include them
// in the served OData $metadata. Without this, nested app/<app>/annotations.cds
// files are not picked up (the app subfolders are treated as UI modules).
using from './my-expenses/annotations';
using from './approve-expenses/annotations';
using from './finance-expenses/annotations';
using from './policy-config/annotations';
using from './user-admin/annotations';
using from './audit-log/annotations';
using from './system-health/annotations';
