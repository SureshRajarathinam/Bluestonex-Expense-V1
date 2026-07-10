sap.ui.define([
  "com/bluestonex/expense/approval/controller/BaseController"
], function (BaseController) {
  "use strict";

  var VIEW_BY_KEY = {
    approvals: "approvalsView",
    policy: "policyView",
    workflow: "workflowView",
    history: "historyView",
    dashboard: "dashboardView"
  };

  return BaseController.extend("com.bluestonex.expense.approval.controller.App", {

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
