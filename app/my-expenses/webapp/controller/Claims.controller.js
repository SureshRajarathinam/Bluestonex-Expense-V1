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
      this._sQuery = (sQuery || "").trim();
      this._applyFilters();
    },

    onDateFilter: function (oEvent) {
      this._dateFrom = oEvent.getParameter("from");
      this._dateTo = oEvent.getParameter("to");
      this._applyFilters();
    },

    _ymd: function (oDate) {
      if (!oDate) { return null; }
      var p = function (n) { return (n < 10 ? "0" : "") + n; };
      return oDate.getFullYear() + "-" + p(oDate.getMonth() + 1) + "-" + p(oDate.getDate());
    },

    _applyFilters: function () {
      var aFilters = [];
      if (this._sQuery) {
        aFilters.push(new Filter("claimNumber", FilterOperator.Contains, this._sQuery));
      }
      if (this._dateFrom && this._dateTo) {
        aFilters.push(new Filter("claimPeriod", FilterOperator.BT, this._ymd(this._dateFrom), this._ymd(this._dateTo)));
      }
      this.byId("claimsTable").getBinding("items").filter(aFilters);
    },

    // ---- Download as Excel --------------------------------------------------
    onExport: function () {
      var aCols = [
        { label: this.getText("colClaimNo"), property: "claimNumber" },
        { label: this.getText("colCountry"), property: "country" },
        { label: this.getText("colPeriod"), property: "claimPeriod" },
        { label: "Period End", property: "periodEnd" },
        { label: this.getText("colStatus"), property: "status" },
        { label: this.getText("colTotal"), property: "totalGross" },
        { label: this.getText("lblCurrency"), property: "currency" }
      ];
      var aRows = this.byId("claimsTable").getBinding("items").getCurrentContexts().map(function (c) {
        var o = {};
        aCols.forEach(function (col) { o[col.property] = c.getProperty(col.property); });
        return o;
      });
      var that = this;
      sap.ui.require(["sap/ui/export/Spreadsheet"], function (Spreadsheet) {
        var oSheet = new Spreadsheet({
          workbook: { columns: aCols },
          dataSource: aRows,
          fileName: "MyExpenseClaims.xlsx"
        });
        oSheet.build().finally(function () { oSheet.destroy(); });
      }, function () {
        that._exportCsv(aCols, aRows, "MyExpenseClaims.csv");
      });
    },

    /** CSV fallback when the spreadsheet library is unavailable. */
    _exportCsv: function (aCols, aRows, sFile) {
      var esc = function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; };
      var aLines = [aCols.map(function (c) { return esc(c.label); }).join(",")];
      aRows.forEach(function (r) { aLines.push(aCols.map(function (c) { return esc(r[c.property]); }).join(",")); });
      var oBlob = new Blob(["﻿" + aLines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
      var oLink = document.createElement("a");
      oLink.href = URL.createObjectURL(oBlob);
      oLink.download = sFile;
      document.body.appendChild(oLink);
      oLink.click();
      document.body.removeChild(oLink);
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
