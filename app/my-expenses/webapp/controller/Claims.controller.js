sap.ui.define([
  "com/bluestonex/expense/myexpenses/controller/BaseController",
  "com/bluestonex/expense/myexpenses/model/formatter",
  "sap/ui/core/Fragment",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator"
], function (BaseController, formatter, Fragment, JSONModel, Filter, FilterOperator) {
  "use strict";

  return BaseController.extend("com.bluestonex.expense.myexpenses.controller.Claims", {

    formatter: formatter,

    onInit: function () {
      this.getView().setModel(new JSONModel({ count: 0 }), "view");
      this.getRouter().getRoute("list").attachPatternMatched(this._onListMatched, this);
    },

    onUpdateFinished: function (oEvent) {
      this.getView().getModel("view").setProperty("/count", oEvent.getParameter("total") || 0);
    },

    _onListMatched: function () {
      var oBinding = this.byId("claimsTable").getBinding("items");
      if (oBinding) {
        oBinding.refresh();
      }
    },

    /** Extract the key predicate (inside the parentheses) from an OData V4 path. */
    _predicateOf: function (sPath) {
      var m = /\(([^)]*)\)/.exec(sPath);
      return m ? m[1] : "";
    },

    onRefresh: function () {
      this.byId("claimsTable").getBinding("items").refresh();
    },

    onSearch: function (oEvent) {
      this.applySearch(oEvent.getParameter("query"));
    },

    applySearch: function (sQuery) {
      var aFilters = [];
      if (sQuery && sQuery.trim()) {
        aFilters.push(new Filter("claimNumber", FilterOperator.Contains, sQuery.trim()));
      }
      this.byId("claimsTable").getBinding("items").filter(aFilters);
    },

    onOpenClaim: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext();
      this.navTo("detail", { key: encodeURIComponent(this._predicateOf(oCtx.getPath())) });
    },

    // ---- Create flow --------------------------------------------------------
    onCreate: function () {
      var that = this;
      if (this._pCountryDialog) {
        this._pCountryDialog.then(function (oDialog) {
          that.byId("countryGroup").setSelectedIndex(-1);
          oDialog.open();
        });
        return;
      }
      this._pCountryDialog = Fragment.load({
        id: this.getView().getId(),
        name: "com.bluestonex.expense.myexpenses.view.CountryDialog",
        controller: this
      }).then(function (oDialog) {
        that.getView().addDependent(oDialog);
        return oDialog;
      });
      this._pCountryDialog.then(function (oDialog) { oDialog.open(); });
    },

    onCountryCancel: function () {
      this.byId("countryDialog").close();
    },

    onCountryContinue: function () {
      var iIdx = this.byId("countryGroup").getSelectedIndex();
      if (iIdx < 0) {
        sap.m.MessageToast.show(this.getText("countryRequired"));
        return;
      }
      var sCountry = iIdx === 0 ? "UK" : "IN";
      var sToday = new Date().toISOString().slice(0, 10);
      var that = this;
      var oList = this.byId("claimsTable").getBinding("items");

      // create(initialData, bSkipRefresh) — skip refresh since we navigate away.
      var oCtx = oList.create({ country: sCountry, claimPeriod: sToday }, true);
      this.byId("countryDialog").close();
      this.getView().setBusy(true);

      oCtx.created().then(function () {
        that.getView().setBusy(false);
        that.navTo("detail", { key: encodeURIComponent(that._predicateOf(oCtx.getPath())) });
      }).catch(function (oErr) {
        that.getView().setBusy(false);
        that.showError(oErr);
      });
    }
  });
});
