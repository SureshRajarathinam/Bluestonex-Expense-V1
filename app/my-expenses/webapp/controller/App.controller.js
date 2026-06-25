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
    },

    onHeaderSearch: function (oEvent) {
      // Forward the query to the list page via the router (kept simple: navigate home).
      var sQuery = oEvent.getParameter("query");
      this.navTo("list");
      var oListView = this.byId("pageContainer").getPages()[0];
      if (oListView && oListView.getController && oListView.getController().applySearch) {
        oListView.getController().applySearch(sQuery);
      }
    }
  });
});
