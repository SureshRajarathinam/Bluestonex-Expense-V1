sap.ui.define([
  "com/bluestonex/expense/myexpenses/controller/BaseController"
], function (BaseController) {
  "use strict";

  return BaseController.extend("com.bluestonex.expense.myexpenses.controller.App", {

    onSideToggle: function () {
      var oTP = this.byId("toolPage");
      oTP.setSideExpanded(!oTP.getSideExpanded());
    },

    onNavToList: function () {
      this.navTo("list");
    }
  });
});
