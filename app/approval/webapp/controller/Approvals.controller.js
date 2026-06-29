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
      this.getView().setModel(new JSONModel({ count: 0, pendUK: 0, pendIN: 0 }), "view");
      // Landing → detail state, mirroring the Policy / Workflow tabs.
      this.getView().setModel(new JSONModel({
        choose: true, detail: false, country: "", isUK: false, isIN: false, title: ""
      }), "ui");
      this._loadCounts();
    },

    // Pending-claim counts per country for the landing cards.
    _loadCounts: function () {
      var oModel = this.getModel();
      var oView = this.getView().getModel("view");
      ["UK", "IN"].forEach(function (sCountry) {
        oModel.bindList("/Approvals", null, null,
          [new Filter("country", FilterOperator.EQ, sCountry)], { $$groupId: "$direct" })
          .requestContexts(0, 999)
          .then(function (aCtx) {
            oView.setProperty(sCountry === "UK" ? "/pendUK" : "/pendIN", aCtx.length);
          })
          .catch(function () { /* leave count at 0 */ });
      });
    },

    onChooseUK: function () { this._open("UK"); },
    onChooseIN: function () { this._open("IN"); },

    // Drill into the chosen country's pending claims (scope the table by country).
    _open: function (sCountry) {
      this.getView().getModel("ui").setData({
        choose: false, detail: true, country: sCountry,
        isUK: sCountry === "UK", isIN: sCountry === "IN",
        title: this.getText(sCountry === "UK" ? "apvTitleUK" : "apvTitleIN")
      });
      this.byId("fClaimNo").setValue("");
      this.onGo();
    },

    onBack: function () {
      this.getView().getModel("ui").setData({
        choose: true, detail: false, country: "", isUK: false, isIN: false, title: ""
      });
      this._loadCounts();
    },

    onUpdateFinished: function (oEvent) {
      this.getView().getModel("view").setProperty("/count", oEvent.getParameter("total") || 0);
    },

    onRefresh: function () {
      this.byId("approvalsTable").getBinding("items").refresh();
      this._loadCounts();
    },

    _ymd: function (oDate) {
      if (!oDate) { return null; }
      var p = function (n) { return (n < 10 ? "0" : "") + n; };
      return oDate.getFullYear() + "-" + p(oDate.getMonth() + 1) + "-" + p(oDate.getDate());
    },

    /** Apply the Look-up filters (Period, Claim No) scoped to the chosen country. */
    onGo: function () {
      var aFilters = [];
      var sCountry = this.getView().getModel("ui").getProperty("/country");
      var sNo = (this.byId("fClaimNo").getValue() || "").trim();
      var oPeriod = this.byId("fPeriod");
      var dFrom = oPeriod.getDateValue(), dTo = oPeriod.getSecondDateValue();

      if (sCountry) { aFilters.push(new Filter("country", FilterOperator.EQ, sCountry)); }
      if (sNo) { aFilters.push(new Filter("claimNumber", FilterOperator.Contains, sNo)); }
      if (dFrom && dTo) { aFilters.push(new Filter("claimPeriod", FilterOperator.BT, this._ymd(dFrom), this._ymd(dTo))); }

      this.byId("approvalsTable").getBinding("items").filter(aFilters);
    },

    onExportPdf: function () {
      this.exportPdf("approvals", {
        status: "",
        country: this.getView().getModel("ui").getProperty("/country"),
        claimNo: (this.byId("fClaimNo").getValue() || "").trim(),
        from: this._ymd(this.byId("fPeriod").getDateValue()),
        to: this._ymd(this.byId("fPeriod").getSecondDateValue())
      });
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
          that._loadCounts();
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
