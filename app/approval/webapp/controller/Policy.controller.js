sap.ui.define([
  "com/bluestonex/expense/approval/controller/BaseController",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/MessageToast"
], function (BaseController, JSONModel, Filter, FilterOperator, MessageToast) {
  "use strict";

  return BaseController.extend("com.bluestonex.expense.approval.controller.Policy", {

    onInit: function () {
      // Start on the country-choice landing screen.
      this.getView().setModel(new JSONModel({
        choose: true, detail: false, display: true, editing: false,
        isUK: false, isIN: false, country: "", title: ""
      }), "ui");
    },

    onChooseUK: function () { this._open("UK"); },
    onChooseIN: function () { this._open("IN"); },

    // Resolve the chosen country's policy row, then bind the detail form to it.
    _open: function (sCountry) {
      var that = this;
      var oUi = this.getView().getModel("ui");
      this.getView().setBusy(true);
      var oList = this.getModel().bindList("/Policies", null, null,
        [new Filter("country", FilterOperator.EQ, sCountry)], { $$groupId: "$direct" });
      oList.requestContexts(0, 1).then(function (aCtx) {
        that.getView().setBusy(false);
        if (!aCtx.length) { MessageToast.show(that.getText("msgNoPolicy")); return; }
        that._sId = aCtx[0].getProperty("ID");
        oUi.setData({
          choose: false, detail: true, display: true, editing: false,
          isUK: sCountry === "UK", isIN: sCountry === "IN", country: sCountry,
          title: that.getText(sCountry === "UK" ? "policyTitleUK" : "policyTitleIN")
        });
        that._bind(true);
      }).catch(function (e) { that.getView().setBusy(false); that.showError(e); });
    },

    _bind: function (bActive) {
      this.getView().bindElement({ path: "/Policies(ID=" + this._sId + ",IsActiveEntity=" + bActive + ")" });
    },

    onBack: function () {
      this.getView().unbindElement();
      this.getView().getModel("ui").setData({
        choose: true, detail: false, display: true, editing: false,
        isUK: false, isIN: false, country: "", title: ""
      });
    },

    onEdit: function () {
      var that = this;
      var oUi = this.getView().getModel("ui");
      var oCtx = this.getView().getBindingContext();
      this.getView().setBusy(true);
      this.callAction(oCtx, "ApprovalService.draftEdit", { PreserveChanges: false })
        .then(function () {
          that.getView().setBusy(false);
          that._bind(false);
          oUi.setProperty("/display", false);
          oUi.setProperty("/editing", true);
        })
        .catch(function (e) { that.getView().setBusy(false); that.showError(e); });
    },

    onSave: function () {
      var that = this;
      var oUi = this.getView().getModel("ui");
      var oCtx = this.getView().getBindingContext();
      this.getView().setBusy(true);
      this.callAction(oCtx, "ApprovalService.draftActivate")
        .then(function () {
          that.getView().setBusy(false);
          that._bind(true);
          oUi.setProperty("/display", true);
          oUi.setProperty("/editing", false);
          MessageToast.show(that.getText("msgPolicySaved"));
        })
        .catch(function (e) { that.getView().setBusy(false); that.showError(e); });
    },

    onCancel: function () {
      var that = this;
      var oUi = this.getView().getModel("ui");
      var oCtx = this.getView().getBindingContext();
      this.getView().setBusy(true);
      oCtx.delete().then(function () {
        that.getView().setBusy(false);
        that._bind(true);
        oUi.setProperty("/display", true);
        oUi.setProperty("/editing", false);
      }).catch(function (e) { that.getView().setBusy(false); that.showError(e); });
    }
  });
});
