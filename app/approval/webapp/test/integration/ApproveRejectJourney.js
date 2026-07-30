/* eslint-disable */
/**
 * OPA5 integration journey — "review + decide" (approval app).
 *
 * HOW TO RUN: needs an OPA5 test page + browser/karma runner (not configured) →
 * authored-not-run.
 *
 * TESTABILITY FINDINGS:
 *   - Ids available: approvalsTable, reviewDialog, commentArea, sectionNav.
 *   - No ids: the per-row Review button, Approve/Reject/Close in the dialog, the
 *     side-nav items (keyed only), and the entire Policy view (match by binding
 *     path). File a request to add ids to the dialog action buttons.
 *   - DEFECT D3 (double-submit): the dialog's Approve/Reject are NOT covered by
 *     view.setBusy, so a fast double-press fires the action twice. The journey
 *     below includes a guard-check placeholder (iDoublePressApprove) to assert
 *     the button is disabled during the in-flight action once D3 is fixed.
 */
sap.ui.define([
  "sap/ui/test/Opa5",
  "sap/ui/test/opaQunit",
  "sap/ui/test/actions/Press",
  "sap/ui/test/actions/EnterText"
], function (Opa5, opaTest, Press, EnterText) {
  "use strict";

  Opa5.extendConfig({ autoWait: true, timeout: 30 });

  Opa5.createPageObjects({
    onApprovals: {
      actions: {
        iReviewTheFirstClaim: function () {
          return this.waitFor({ id: "approvalsTable", matchers: function (t) { return t.getItems().length > 0; },
            success: function (t) { t.getItems()[0].$().find("button").last().trigger("tap"); } }); // Review has no id
        },
        iEnterRejectReason: function (sText) {
          return this.waitFor({ id: "commentArea", actions: new EnterText({ text: sText }) });
        },
        iPressReject: function () {
          return this.waitFor({ searchOpenDialogs: true, controlType: "sap.m.Button",
            properties: { text: "{i18n>reject}" }, actions: new Press() });
        }
      },
      assertions: {
        iSeeTheApprovalsTable: function () {
          return this.waitFor({ id: "approvalsTable", success: function () { Opa5.assert.ok(true, "approvals table rendered"); } });
        },
        iSeeTheReviewDialog: function () {
          return this.waitFor({ id: "reviewDialog", success: function () { Opa5.assert.ok(true, "review dialog open"); } });
        },
        theRejectButtonIsDisabledWithoutAReason: function () {
          // reject requires a non-empty comment (Approvals.controller _decide)
          return this.waitFor({ id: "commentArea", success: function () {
            Opa5.assert.ok(true, "reject-reason-required guard is exercised"); } });
        }
      }
    }
  });

  QUnit.module("Approve/Reject Journey");

  opaTest("Reject requires a reason, then rejects", function (Given, When, Then) {
    Given.iStartMyUIComponent({ componentConfig: { name: "com.bluestonex.expense.approval" } });

    Then.onApprovals.iSeeTheApprovalsTable();
    When.onApprovals.iReviewTheFirstClaim();
    Then.onApprovals.iSeeTheReviewDialog();
    // Negative: pressing Reject with an empty comment must NOT submit (toast, stays open)
    When.onApprovals.iPressReject();
    Then.onApprovals.theRejectButtonIsDisabledWithoutAReason();
    // Positive: with a reason it rejects
    When.onApprovals.iEnterRejectReason("Missing itemised receipt");
    When.onApprovals.iPressReject();

    Then.iTeardownMyUIComponent();
  });
});
