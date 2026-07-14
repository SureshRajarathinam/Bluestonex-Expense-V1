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
      // Open directly on UK (no country landing); the corner Select switches country.
      this.getView().setModel(new JSONModel({
        choose: false, detail: true, country: "UK", isUK: true, isIN: false, title: this.getText("apvTitleUK")
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

    // Corner country switch — funnels through the existing _open (same data logic).
    onSwitchCountry: function (oEvent) { this._open(oEvent.getParameter("selectedItem").getKey()); },

    // Drill into the chosen country's pending claims (scope the table by country).
    _open: function (sCountry) {
      this.getView().getModel("ui").setData({
        choose: false, detail: true, country: sCountry,
        isUK: sCountry === "UK", isIN: sCountry === "IN",
        title: this.getText(sCountry === "UK" ? "apvTitleUK" : "apvTitleIN")
      });
      this.byId("fSearch").setValue("");
      this.onGo();
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

    /** Free multi-field search (claim no · employee · emp ID · status) + Period,
     *  scoped to the chosen country. Fires on Enter / search-icon and on Period
     *  change — no Go button. */
    onGo: function () {
      var aFilters = [];
      var sCountry = this.getView().getModel("ui").getProperty("/country");
      var sQ = (this.byId("fSearch").getValue() || "").trim();
      var oPeriod = this.byId("fPeriod");
      var dFrom = oPeriod.getDateValue(), dTo = oPeriod.getSecondDateValue();

      if (sCountry) { aFilters.push(new Filter("country", FilterOperator.EQ, sCountry)); }
      if (dFrom && dTo) { aFilters.push(new Filter("claimPeriod", FilterOperator.BT, this._ymd(dFrom), this._ymd(dTo))); }
      if (sQ) {
        aFilters.push(new Filter({
          filters: [
            new Filter("claimNumber", FilterOperator.Contains, sQ),
            new Filter("employeeName", FilterOperator.Contains, sQ),
            new Filter("employeeNumber", FilterOperator.Contains, sQ),
            new Filter("status", FilterOperator.Contains, sQ)
          ],
          and: false
        }));
      }

      this.byId("approvalsTable").getBinding("items").filter(aFilters);
    },

    onExportPdf: function () {
      this.exportPdf("approvals", {
        status: "",
        country: this.getView().getModel("ui").getProperty("/country"),
        claimNo: (this.byId("fSearch").getValue() || "").trim(),
        from: this._ymd(this.byId("fPeriod").getDateValue()),
        to: this._ymd(this.byId("fPeriod").getSecondDateValue())
      });
    },

    // Open on UK each time the tab is (re)entered; the corner Select switches country.
    onTabEnter: function () { this._open("UK"); },

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

      // Guard against a double-submit: the Approve/Reject buttons live in the
      // dialog (static area), which view.setBusy does NOT cover, so a fast
      // double-click could fire the action twice. Busy the DIALOG and gate on a
      // reentrancy flag (fix D3).
      if (this._deciding) { return; }
      this._deciding = true;

      var that = this;
      oDialog.setBusy(true);
      this.callAction(oCtx, "ApprovalService." + sAction, { comment: sComment })
        .then(function () {
          that._deciding = false;
          oDialog.setBusy(false);
          oDialog.close();
          MessageToast.show(that.getText(sMsgKey));
          that.byId("approvalsTable").getBinding("items").refresh();
          that._loadCounts();
        })
        .catch(function (e) {
          that._deciding = false;
          oDialog.setBusy(false);
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
