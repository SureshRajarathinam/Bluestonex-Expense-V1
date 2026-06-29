sap.ui.define([
  "com/bluestonex/expense/approval/controller/BaseController"
], function (BaseController) {
  "use strict";

  var VIEW_BY_KEY = {
    approvals: "approvalsView",
    policy: "policyView",
    workflow: "workflowView",
    history: "historyView"
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
      // Refresh the section's data so it reflects the latest state on each switch.
      var oCtrl = oView.getController && oView.getController();
      if (oCtrl && typeof oCtrl.onRefresh === "function") { oCtrl.onRefresh(); }
    }
  });
});
