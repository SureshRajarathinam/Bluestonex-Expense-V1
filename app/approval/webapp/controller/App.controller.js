sap.ui.define([
  "com/bluestonex/expense/approval/controller/BaseController"
], function (BaseController) {
  "use strict";

  return BaseController.extend("com.bluestonex.expense.approval.controller.App", {
    onSideToggle: function () {
      var oTP = this.byId("toolPage");
      oTP.setSideExpanded(!oTP.getSideExpanded());
    }
  });
});
