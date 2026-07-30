sap.ui.define([
  "com/bluestonex/expense/myexpenses/controller/BaseController",
  "sap/ui/model/json/JSONModel"
], function (BaseController, JSONModel) {
  "use strict";

  return BaseController.extend("com.bluestonex.expense.myexpenses.controller.App", {

    onInit: function () {
      // sideExpanded drives the side-rail chevron icon (◅ when open, ▻ when collapsed).
      this.getView().setModel(new JSONModel({ greeting: "", sideExpanded: false }), "app");
      this._loadGreeting();
    },

    // Greet the logged-in employee by name (resolved server-side from $user via
    // the ExpenseService whoami function). Silent no-op if it can't resolve.
    _loadGreeting: function () {
      var oView = this.getView();
      // Resolve against the OData model's service URL (not the literal "expense/")
      // so the greeting fetch hits the app mount under the Work Zone approuter.
      fetch(this._serviceUrl() + "whoami()", { headers: { Accept: "application/json" }, credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j) { return; }
          var name = [j.firstName, j.lastName].filter(Boolean).join(" ") || j.fullName || "";
          if (!name) { return; }
          var sGreeting = oView.getModel("i18n").getResourceBundle().getText("greeting", [name]);
          oView.getModel("app").setProperty("/greeting", sGreeting);
        })
        .catch(function () { /* greeting is optional — ignore */ });
    },

    // Expand/collapse the side rail via the pinned chevron (the ☰ header button was
    // removed). Mirrors the state into app>/sideExpanded so the chevron icon flips,
    // and restores the nav selection (the toggle item must not steal the highlight).
    onSideToggle: function () {
      var oTP = this.byId("toolPage");
      var bExpanded = !oTP.getSideExpanded();
      oTP.setSideExpanded(bExpanded);
      this.getView().getModel("app").setProperty("/sideExpanded", bExpanded);
      var oNav = this.byId("sideNav");
      if (oNav) { oNav.setSelectedKey("myExpenses"); }
    },

    onNavToList: function () {
      this.navTo("list");
    }
  });
});
