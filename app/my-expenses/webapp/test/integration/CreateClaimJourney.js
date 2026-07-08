/* eslint-disable */
/**
 * OPA5 integration journey — "create a UK claim end to end" (my-expenses).
 *
 * HOW TO RUN: needs an OPA5 test page (opaTests.qunit.html bootstrapping the
 * component) + a browser/karma runner. Not configured in this repo → authored-
 * not-run. Wire a runner to execute.
 *
 * TESTABILITY FINDINGS baked in below (see Defect Report "UI testability"):
 *   - Controls WITH ids we can target: claimsTable, countryDialog, countryGroup,
 *     itemsTable, mileageTable, claimPage, claimsPage.
 *   - Controls WITHOUT ids (must be matched by i18n text / binding path, which is
 *     brittle): Create button, CountryDialog Continue/Cancel + the two radios,
 *     Add Item / Add Mileage, and ALL footer buttons (Edit/Discard/Save/Submit).
 *   - Country choice is resolved by RADIO INDEX (0→UK,1→IN) in the controller —
 *     assert via index, and file a request to add stable ids + a key.
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
        },
        iChooseCountryUK: function () {
          // countryGroup has an id; radios do not → select index 0 (=UK).
          return this.waitFor({ id: "countryGroup", success: function (oGroup) { oGroup.setSelectedIndex(0); } });
        },
        iPressContinue: function () {
          return this.waitFor({ searchOpenDialogs: true, controlType: "sap.m.Button", properties: { text: "{i18n>continue}" }, actions: new Press() });
        }
      },
      assertions: {
        iSeeTheClaimsTable: function () {
          return this.waitFor({ id: "claimsTable", success: function () { Opa5.assert.ok(true, "claims table rendered"); } });
        },
        iSeeTheCountryDialog: function () {
          return this.waitFor({ id: "countryDialog", success: function () { Opa5.assert.ok(true, "country dialog open"); } });
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

  opaTest("Create → pick UK → add an item → save", function (Given, When, Then) {
    Given.iStartMyUIComponent({ componentConfig: { name: "com.bluestonex.expense.myexpenses" } });

    Then.onTheListPage.iSeeTheClaimsTable();
    When.onTheListPage.iPressCreate();
    Then.onTheListPage.iSeeTheCountryDialog();
    When.onTheListPage.iChooseCountryUK();
    When.onTheListPage.iPressContinue();

    Then.onTheClaimPage.iSeeTheItemsTable();
    When.onTheClaimPage.iAddAnItem();
    Then.onTheClaimPage.iSeeOneItemRow();
    When.onTheClaimPage.iPressSave();

    Then.iTeardownMyUIComponent();
  });
});
