sap.ui.define([
  "com/bluestonex/expense/myexpenses/controller/BaseController",
  "com/bluestonex/expense/myexpenses/model/formatter",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageBox",
  "sap/m/MessageToast"
], function (BaseController, formatter, JSONModel, MessageBox, MessageToast) {
  "use strict";

  var SVC = "/expense";

  return BaseController.extend("com.bluestonex.expense.myexpenses.controller.Claim", {

    formatter: formatter,

    onInit: function () {
      this.getView().setModel(new JSONModel({ editable: false, canEdit: false, canSubmit: false }), "ui");
      this.getRouter().getRoute("detail").attachPatternMatched(this._onMatched, this);
    },

    _predicateOf: function (sPath) {
      var m = /\(([^)]*)\)/.exec(sPath);
      return m ? m[1] : "";
    },

    _onMatched: function (oEvent) {
      var sPredicate = decodeURIComponent(oEvent.getParameter("arguments").key);
      this._bindClaim(sPredicate);
    },

    _bindClaim: function (sPredicate) {
      var bEditable = sPredicate.indexOf("IsActiveEntity=false") > -1;
      var oUi = this.getView().getModel("ui");
      oUi.setProperty("/editable", bEditable);
      oUi.setProperty("/canEdit", false);
      oUi.setProperty("/canSubmit", false);
      var that = this;
      this.getView().bindElement({
        path: "/MyClaims(" + sPredicate + ")",
        parameters: { $expand: "items,mileageClaims" },
        events: {
          dataReceived: function () {
            var oCtx = that.getView().getBindingContext();
            var sStatus = oCtx && oCtx.getProperty("status");
            var bDraft = !sStatus || sStatus === "Draft";
            oUi.setProperty("/canSubmit", bDraft);
            oUi.setProperty("/canEdit", !bEditable && bDraft);
          }
        }
      });
    },

    _claimCtx: function () {
      return this.getView().getBindingContext();
    },

    // ---- Inline rows --------------------------------------------------------
    onAddItem: function () {
      var sToday = new Date().toISOString().slice(0, 10);
      this.byId("itemsTable").getBinding("items").create({
        vatType: "STD", expenseDate: sToday
      }, true);
    },

    onDeleteItem: function (oEvent) {
      oEvent.getSource().getBindingContext().delete().catch(this.showError.bind(this));
    },

    onAddMileage: function () {
      var sToday = new Date().toISOString().slice(0, 10);
      this.byId("mileageTable").getBinding("mileageClaims").create({
        engineType: "Petrol", ratePerMile: "0.25", tripDate: sToday
      }, true);
    },

    onDeleteMileage: function (oEvent) {
      oEvent.getSource().getBindingContext().delete().catch(this.showError.bind(this));
    },

    // ---- Receipt upload (CAP media PUT) ------------------------------------
    _getToken: function () {
      if (this._csrf) { return Promise.resolve(this._csrf); }
      var that = this;
      return fetch(SVC + "/", { method: "HEAD", headers: { "x-csrf-token": "Fetch" }, credentials: "same-origin" })
        .then(function (r) { that._csrf = r.headers.get("x-csrf-token"); return that._csrf; });
    },

    onUploadReceipt: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext();
      var that = this;
      var oInput = document.createElement("input");
      oInput.type = "file";
      oInput.accept = "image/*,application/pdf";
      oInput.onchange = function () {
        var oFile = oInput.files && oInput.files[0];
        if (oFile) { that._putReceipt(oCtx, oFile); }
      };
      oInput.click();
    },

    _putReceipt: function (oCtx, oFile) {
      var sId = oCtx.getProperty("ID");
      var bActive = oCtx.getProperty("IsActiveEntity");
      var sUrl = SVC + "/MyClaimItems(ID=" + sId + ",IsActiveEntity=" + bActive + ")/receipt";
      var that = this;
      this.getView().setBusy(true);
      this._getToken().then(function (sToken) {
        return fetch(sUrl, {
          method: "PUT",
          headers: {
            "x-csrf-token": sToken,
            "Content-Type": oFile.type || "application/octet-stream",
            "Content-Disposition": 'inline; filename="' + oFile.name + '"'
          },
          body: oFile,
          credentials: "same-origin"
        });
      }).then(function (r) {
        if (!r.ok) { throw new Error("Upload failed (" + r.status + ")"); }
        oCtx.setProperty("receiptAttached", true);
        that.getView().setBusy(false);
        MessageToast.show(that.getText("msgUploadOk"));
      }).catch(function (e) {
        that.getView().setBusy(false);
        that.showError(e);
      });
    },

    // ---- Lifecycle ----------------------------------------------------------
    onEdit: function () {
      var that = this;
      this.getView().setBusy(true);
      this.callAction(this._claimCtx(), "ExpenseService.draftEdit", { PreserveChanges: true })
        .then(function (oDraft) {
          that.getView().setBusy(false);
          that._bindClaim(that._predicateOf(oDraft.getPath()));
        })
        .catch(function (e) { that.getView().setBusy(false); that.showError(e); });
    },

    onSave: function () {
      var that = this;
      this.getView().setBusy(true);
      this.callAction(this._claimCtx(), "ExpenseService.draftActivate", {}, { $$inheritExpandSelect: true })
        .then(function (oActivated) {
          that.getView().setBusy(false);
          that._bindClaim("ID=" + oActivated.getProperty("ID") + ",IsActiveEntity=true");
          MessageToast.show(that.getText("msgSaved"));
        })
        .catch(function (e) { that.getView().setBusy(false); that.showError(e); });
    },

    onSubmit: function () {
      var that = this;
      var oCtx = this._claimCtx();
      var bDraft = oCtx.getPath().indexOf("IsActiveEntity=false") > -1;
      this.getView().setBusy(true);

      // Resolve the active entity's ID (activating the draft if needed). Validation
      // runs inside submitClaim on the active record, so we must activate first.
      var pId = bDraft
        ? this.callAction(oCtx, "ExpenseService.draftActivate", {}, { $$inheritExpandSelect: true })
            .then(function (oActivated) { return oActivated.getProperty("ID"); })
        : Promise.resolve(oCtx.getProperty("ID"));

      pId
        .then(function (sId) {
          var oActive = that.getModel().bindContext("/MyClaims(ID=" + sId + ",IsActiveEntity=true)").getBoundContext();
          return that.callAction(oActive, "ExpenseService.submitClaim").then(function () {
            that.getView().setBusy(false);
            MessageToast.show(that.getText("msgSubmitted"));
            that.navTo("list");
          }, function (oErr) {
            // Submit rejected (e.g. validation 422): the draft is now an active Draft.
            // Rebind so the page reflects the saved active record (Edit to fix & retry).
            that.getView().setBusy(false);
            that._bindClaim("ID=" + sId + ",IsActiveEntity=true");
            throw oErr;
          });
        })
        .catch(function (e) { that.getView().setBusy(false); that.showError(e); });
    },

    onDiscard: function () {
      var that = this;
      MessageBox.warning(this.getText("confirmDiscard"), {
        title: this.getText("confirmDiscardTitle"),
        actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
        emphasizedAction: MessageBox.Action.OK,
        onClose: function (sAction) {
          if (sAction !== MessageBox.Action.OK) { return; }
          that.getView().setBusy(true);
          that._claimCtx().delete().then(function () {
            that.getView().setBusy(false);
            MessageToast.show(that.getText("msgDiscarded"));
            that.navTo("list");
          }).catch(function (e) { that.getView().setBusy(false); that.showError(e); });
        }
      });
    },

    onBack: function () {
      this.navTo("list");
    }
  });
});
