sap.ui.define([
  "com/bluestonex/expense/approval/controller/BaseController",
  "sap/ui/model/json/JSONModel"
], function (BaseController, JSONModel) {
  "use strict";

  var VIEW_BY_KEY = {
    approvals: "approvalsView",
    policy: "policyView",
    workflow: "workflowView",
    history: "historyView",
    dashboard: "dashboardView"
  };

  return BaseController.extend("com.bluestonex.expense.approval.controller.App", {

    onInit: function () {
      this.getView().setModel(new JSONModel({ greeting: "" }), "app");
      this._loadGreeting();
    },

    // Greet the logged-in approver by name — same logic as the my-expenses app
    // (resolved server-side from $user via ApprovalService whoami). Optional: a
    // silent no-op if it can't resolve. Uses _serviceUrl() so the fetch hits the
    // app mount under the Work Zone managed approuter (never a bare relative path).
    _loadGreeting: function () {
      var oView = this.getView();
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

    onSideToggle: function () {
      var oTP = this.byId("toolPage");
      oTP.setSideExpanded(!oTP.getSideExpanded());
    },

    onNavSelect: function (oEvent) {
      var sKey = oEvent.getParameter("item").getKey();
      var sViewId = VIEW_BY_KEY[sKey];
      if (!sViewId) { return; }
      var oView = this.byId(sViewId);
      this.byId("sectionNav").to(oView.getId());
      // On each switch, reset the section to its landing state (tabs with a
      // drill-in/edit flow expose onTabEnter); otherwise just refresh its data.
      var oCtrl = oView.getController && oView.getController();
      if (oCtrl && typeof oCtrl.onTabEnter === "function") { oCtrl.onTabEnter(); }
      else if (oCtrl && typeof oCtrl.onRefresh === "function") { oCtrl.onRefresh(); }
    }
  });
});
