sap.ui.define([
  "com/bluestonex/expense/approval/controller/BaseController",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast"
], function (BaseController, JSONModel, MessageToast) {
  "use strict";

  return BaseController.extend("com.bluestonex.expense.approval.controller.Policy", {

    onInit: function () {
      this.getView().setModel(new JSONModel({ display: true, editing: false }), "ui");
      this._loadPolicy();
    },

    _loadPolicy: function () {
      var that = this;
      // Fetch the (single) active policy ID, then bind the form to it.
      var oList = this.getModel().bindList("/Policies", null, null, null, { $$groupId: "$direct" });
      oList.requestContexts(0, 1).then(function (aCtx) {
        if (aCtx.length) {
          that._sId = aCtx[0].getProperty("ID");
          that._bind(true);
        }
      }).catch(function (e) { that.showError(e); });
    },

    _bind: function (bActive) {
      this.getView().bindElement({ path: "/Policies(ID=" + this._sId + ",IsActiveEntity=" + bActive + ")" });
    },

    onEdit: function () {
      var that = this;
      var oCtx = this.getView().getBindingContext();
      this.getView().setBusy(true);
      this.callAction(oCtx, "ApprovalService.draftEdit", { PreserveChanges: false })
        .then(function (oDraft) {
          that.getView().setBusy(false);
          that._bind(false);
          that.getView().getModel("ui").setData({ display: false, editing: true });
        })
        .catch(function (e) { that.getView().setBusy(false); that.showError(e); });
    },

    onSave: function () {
      var that = this;
      var oCtx = this.getView().getBindingContext();
      this.getView().setBusy(true);
      this.callAction(oCtx, "ApprovalService.draftActivate")
        .then(function () {
          that.getView().setBusy(false);
          that._bind(true);
          that.getView().getModel("ui").setData({ display: true, editing: false });
          MessageToast.show(that.getText("msgPolicySaved"));
        })
        .catch(function (e) { that.getView().setBusy(false); that.showError(e); });
    },

    onCancel: function () {
      var that = this;
      var oCtx = this.getView().getBindingContext();
      this.getView().setBusy(true);
      oCtx.delete().then(function () {
        that.getView().setBusy(false);
        that._bind(true);
        that.getView().getModel("ui").setData({ display: true, editing: false });
      }).catch(function (e) { that.getView().setBusy(false); that.showError(e); });
    }
  });
});
