sap.ui.define([
  "com/bluestonex/expense/approval/controller/BaseController",
  "com/bluestonex/expense/approval/model/formatter",
  "sap/ui/core/Fragment",
  "sap/m/MessageToast"
], function (BaseController, formatter, Fragment, MessageToast) {
  "use strict";

  return BaseController.extend("com.bluestonex.expense.approval.controller.Workflow", {

    formatter: formatter,

    onRefresh: function () {
      this.byId("wfTable").getBinding("items").refresh();
    },

    onEditMember: function (oEvent) {
      var oRowCtx = oEvent.getSource().getBindingContext();
      var sCountry = oRowCtx.getProperty("country");
      var that = this;
      this.getView().setBusy(true);

      // Open a draft for this member, then bind the dialog to it.
      this.callAction(oRowCtx, "ApprovalService.draftEdit", { PreserveChanges: false })
        .then(function () {
          var oDraftCtx = that.getModel()
            .bindContext("/WorkflowMembers(country='" + sCountry + "',IsActiveEntity=false)")
            .getBoundContext();
          return that._openDialog(oDraftCtx);
        })
        .then(function () { that.getView().setBusy(false); })
        .catch(function (e) { that.getView().setBusy(false); that.showError(e); });
    },

    _openDialog: function (oDraftCtx) {
      var that = this;
      var pDialog = this._pDialog || (this._pDialog = Fragment.load({
        id: this.getView().getId(),
        name: "com.bluestonex.expense.approval.view.MemberDialog",
        controller: this
      }).then(function (oDialog) {
        that.getView().addDependent(oDialog);
        return oDialog;
      }));
      return pDialog.then(function (oDialog) {
        oDialog.setBindingContext(oDraftCtx);
        oDialog.open();
      });
    },

    onSaveMember: function () {
      var that = this;
      var oDialog = this.byId("memberDialog");
      var oDraftCtx = oDialog.getBindingContext();
      this.getView().setBusy(true);
      this.callAction(oDraftCtx, "ApprovalService.draftActivate")
        .then(function () {
          that.getView().setBusy(false);
          oDialog.close();
          MessageToast.show(that.getText("msgWorkflowSaved"));
          that.byId("wfTable").getBinding("items").refresh();
        })
        .catch(function (e) { that.getView().setBusy(false); that.showError(e); });
    },

    onCancelMember: function () {
      var that = this;
      var oDialog = this.byId("memberDialog");
      var oDraftCtx = oDialog.getBindingContext();
      this.getView().setBusy(true);
      oDraftCtx.delete().then(function () {
        that.getView().setBusy(false);
        oDialog.close();
      }).catch(function (e) {
        that.getView().setBusy(false);
        oDialog.close();
      });
    }
  });
});
