sap.ui.define([
  "com/bluestonex/expense/approval/controller/BaseController",
  "com/bluestonex/expense/approval/model/formatter",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator"
], function (BaseController, formatter, JSONModel, Filter, FilterOperator) {
  "use strict";

  return BaseController.extend("com.bluestonex.expense.approval.controller.History", {

    formatter: formatter,

    onInit: function () {
      this.getView().setModel(new JSONModel({ count: 0, approved: 0, rejected: 0 }), "view");
    },

    onUpdateFinished: function (oEvent) {
      var oView = this.getView().getModel("view");
      oView.setProperty("/count", oEvent.getParameter("total") || 0);
      var aCtx = this.byId("historyTable").getBinding("items").getCurrentContexts();
      var nA = 0, nR = 0;
      aCtx.forEach(function (c) {
        if (c.getProperty("status") === "Approved") { nA++; }
        if (c.getProperty("status") === "Rejected") { nR++; }
      });
      oView.setProperty("/approved", nA);
      oView.setProperty("/rejected", nR);
    },

    onRefresh: function () {
      this.byId("historyTable").getBinding("items").refresh();
    },

    _ymd: function (oDate) {
      if (!oDate) { return null; }
      var p = function (n) { return (n < 10 ? "0" : "") + n; };
      return oDate.getFullYear() + "-" + p(oDate.getMonth() + 1) + "-" + p(oDate.getDate());
    },

    _filterState: function () {
      return {
        status: this.byId("fStatus").getSelectedKey(),
        country: this.byId("fCountry").getSelectedKey(),
        claimNo: (this.byId("fClaimNo").getValue() || "").trim(),
        from: this._ymd(this.byId("fPeriod").getDateValue()),
        to: this._ymd(this.byId("fPeriod").getSecondDateValue())
      };
    },

    onGo: function () {
      var s = this._filterState();
      var aFilters = [];
      if (s.status) { aFilters.push(new Filter("status", FilterOperator.EQ, s.status)); }
      if (s.country) { aFilters.push(new Filter("country", FilterOperator.EQ, s.country)); }
      if (s.claimNo) { aFilters.push(new Filter("claimNumber", FilterOperator.Contains, s.claimNo)); }
      if (s.from && s.to) { aFilters.push(new Filter("claimPeriod", FilterOperator.BT, s.from, s.to)); }
      this.byId("historyTable").getBinding("items").filter(aFilters);
    },

    onExportPdf: function () {
      this.exportPdf("history", this._filterState());
    }
  });
});
