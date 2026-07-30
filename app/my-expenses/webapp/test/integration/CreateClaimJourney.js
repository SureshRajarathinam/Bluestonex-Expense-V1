/* eslint-disable */
/**
 * OPA5 integration journey — "create a claim end to end" (my-expenses).
 *
 * HOW TO RUN: needs an OPA5 test page (opaTests.qunit.html bootstrapping the
 * component) + a browser/karma runner. Not configured in this repo → authored-
 * not-run. Wire a runner to execute.
 *
 * FLOW NOTE: Create no longer shows a country picker. The country is derived
 * from the logged-in user's site code (BaseSiteKey via whoami): a UK*/IN* site
 * navigates straight to the claim entry screen; any other site shows an
 * information popup and creates nothing. This journey assumes the mock user has
 * a UK/IN site, so Create lands directly on the claim page.
 *
 * TESTABILITY FINDINGS baked in below (see Defect Report "UI testability"):
 *   - Controls WITH ids we can target: claimsTable, itemsTable, mileageTable,
 *     claimPage, claimsPage.
 *   - Controls WITHOUT ids (must be matched by i18n text / binding path, which is
 *     brittle): Create button, Add Item / Add Mileage, and ALL footer buttons
 *     (Edit/Discard/Save/Submit).
 */
sap.ui.define([
  "sap/ui/test/Opa5",
  "sap/ui/test/opaQunit",
  "sap/ui/test/actions/Press",
  "sap/ui/test/matchers/Properties"
], function (Opa5, opaTest, Press, Properties) {
  "use strict";

  Opa5.extendConfig({ autoWait: true, timeout: 30 });

  Opa5.createPageObjects({
    onTheListPage: {
      actions: {
        iPressCreate: function () {
          // No id on the Create button → match by i18n text (TESTABILITY GAP).
          return this.waitFor({ controlType: "sap.m.Button", properties: { text: "{i18n>create}" }, actions: new Press() });
        }
      },
      assertions: {
        iSeeTheClaimsTable: function () {
          return this.waitFor({ id: "claimsTable", success: function () { Opa5.assert.ok(true, "claims table rendered"); } });
        }
      }
    },

    onTheClaimPage: {
      actions: {
        iAddAnItem: function () {
          // Add Item button has no id → match by i18n text (TESTABILITY GAP).
          return this.waitFor({ controlType: "sap.m.Button", properties: { text: "{i18n>addItem}" }, actions: new Press() });
        },
        iPressSave: function () {
          return this.waitFor({ controlType: "sap.m.Button", properties: { text: "{i18n>save}" }, actions: new Press() });
        }
      },
      assertions: {
        iSeeTheItemsTable: function () {
          return this.waitFor({ id: "itemsTable", success: function () { Opa5.assert.ok(true, "items table rendered"); } });
        },
        iSeeOneItemRow: function () {
          return this.waitFor({ id: "itemsTable", matchers: function (oTable) { return oTable.getItems().length >= 1; },
            success: function () { Opa5.assert.ok(true, "an item row was added inline"); } });
        }
      }
    }
  });

  QUnit.module("Create Claim Journey");

  opaTest("Create (UK/IN site) → land on claim page → add an item → save", function (Given, When, Then) {
    Given.iStartMyUIComponent({ componentConfig: { name: "com.bluestonex.expense.myexpenses" } });

    Then.onTheListPage.iSeeTheClaimsTable();
    When.onTheListPage.iPressCreate();
    // No country dialog anymore — a UK/IN site navigates straight to the claim.
    Then.onTheClaimPage.iSeeTheItemsTable();
    When.onTheClaimPage.iAddAnItem();
    Then.onTheClaimPage.iSeeOneItemRow();
    When.onTheClaimPage.iPressSave();

    Then.iTeardownMyUIComponent();
  });
});
