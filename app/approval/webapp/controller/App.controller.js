sap.ui.define([
  "com/bluestonex/expense/approval/controller/BaseController"
], function (BaseController) {
  "use strict";

  var VIEW_BY_KEY = {
    approvals: "approvalsView",
    policy: "policyView",
    workflow: "workflowView"
  };

  return BaseController.extend("com.bluestonex.expense.approval.controller.App", {

    onSideToggle: function () {
      var oTP = this.byId("toolPage");
      oTP.setSideExpanded(!oTP.getSideExpanded());
    },

    onNavSelect: function (oEvent) {
      var sKey = oEvent.getParameter("item").getKey();
      var sViewId = VIEW_BY_KEY[sKey];
      if (sViewId) {
        this.byId("sectionNav").to(this.byId(sViewId).getId());
      }
    }
  });
});
