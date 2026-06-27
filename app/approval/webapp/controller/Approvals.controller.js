sap.ui.define([
  "com/bluestonex/expense/approval/controller/BaseController",
  "com/bluestonex/expense/approval/model/formatter",
  "sap/ui/core/Fragment",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/MessageToast"
], function (BaseController, formatter, Fragment, JSONModel, Filter, FilterOperator, MessageToast) {
  "use strict";

  return BaseController.extend("com.bluestonex.expense.approval.controller.Approvals", {

    formatter: formatter,

    onInit: function () {
      this.getView().setModel(new JSONModel({ count: 0, uk: 0, india: 0 }), "view");
    },

    onUpdateFinished: function (oEvent) {
      var oView = this.getView().getModel("view");
      oView.setProperty("/count", oEvent.getParameter("total") || 0);
      var aCtx = this.byId("approvalsTable").getBinding("items").getCurrentContexts();
      var nUK = 0, nIN = 0;
      aCtx.forEach(function (c) {
        if (c.getProperty("country") === "UK") { nUK++; }
        if (c.getProperty("country") === "IN") { nIN++; }
      });
      oView.setProperty("/uk", nUK);
      oView.setProperty("/india", nIN);
    },

    onRefresh: function () {
      this.byId("approvalsTable").getBinding("items").refresh();
    },

    _ymd: function (oDate) {
      if (!oDate) { return null; }
      var p = function (n) { return (n < 10 ? "0" : "") + n; };
      return oDate.getFullYear() + "-" + p(oDate.getMonth() + 1) + "-" + p(oDate.getDate());
    },

    /** Apply the Look-up card filters (country, period, claim no). */
    onGo: function () {
      var aFilters = [];
      var sCountry = this.byId("fCountry").getSelectedKey();
      var sNo = (this.byId("fClaimNo").getValue() || "").trim();
      var oPeriod = this.byId("fPeriod");
      var dFrom = oPeriod.getDateValue(), dTo = oPeriod.getSecondDateValue();

      if (sCountry) { aFilters.push(new Filter("country", FilterOperator.EQ, sCountry)); }
      if (sNo) { aFilters.push(new Filter("claimNumber", FilterOperator.Contains, sNo)); }
      if (dFrom && dTo) { aFilters.push(new Filter("claimPeriod", FilterOperator.BT, this._ymd(dFrom), this._ymd(dTo))); }

      this.byId("approvalsTable").getBinding("items").filter(aFilters);
    },

    onExport: function () {
      var aCols = [
        { label: this.getText("colClaimNo"), property: "claimNumber" },
        { label: this.getText("colEmployee"), property: "employeeName" },
        { label: this.getText("colCountry"), property: "country" },
        { label: this.getText("colPeriod"), property: "claimPeriod" },
        { label: this.getText("colStatus"), property: "status" },
        { label: this.getText("colTotal"), property: "totalGross" }
      ];
      var aRows = this.byId("approvalsTable").getBinding("items").getCurrentContexts().map(function (c) {
        var o = {};
        aCols.forEach(function (col) { o[col.property] = c.getProperty(col.property); });
        return o;
      });
      var that = this;
      sap.ui.require(["sap/ui/export/Spreadsheet"], function (Spreadsheet) {
        var oSheet = new Spreadsheet({ workbook: { columns: aCols }, dataSource: aRows, fileName: "Approvals.xlsx" });
        oSheet.build().finally(function () { oSheet.destroy(); });
      }, function () {
        that._exportCsv(aCols, aRows, "Approvals.csv");
      });
    },

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

    onReview: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext();
      var that = this;
      var pDialog = this._pReviewDialog || (this._pReviewDialog = Fragment.load({
        id: this.getView().getId(),
        name: "com.bluestonex.expense.approval.view.ReviewDialog",
        controller: this
      }).then(function (oDialog) {
        that.getView().addDependent(oDialog);
        return oDialog;
      }));

      pDialog.then(function (oDialog) {
        oDialog.setBindingContext(oCtx);
        that.byId("commentArea").setValue("");
        oDialog.open();
      });
    },

    onCloseReview: function () {
      this.byId("reviewDialog").close();
    },

    _decide: function (sAction, sMsgKey) {
      var oDialog = this.byId("reviewDialog");
      var oCtx = oDialog.getBindingContext();
      var sComment = this.byId("commentArea").getValue();

      if (sAction === "reject" && !sComment.trim()) {
        MessageToast.show(this.getText("rejectReasonRequired"));
        return;
      }

      var that = this;
      this.getView().setBusy(true);
      this.callAction(oCtx, "ApprovalService." + sAction, { comment: sComment })
        .then(function () {
          that.getView().setBusy(false);
          oDialog.close();
          MessageToast.show(that.getText(sMsgKey));
          that.byId("approvalsTable").getBinding("items").refresh();
        })
        .catch(function (e) {
          that.getView().setBusy(false);
          that.showError(e);
        });
    },

    onApprove: function () {
      this._decide("approve", "msgApproved");
    },

    onReject: function () {
      this._decide("reject", "msgRejected");
    }
  });
});
