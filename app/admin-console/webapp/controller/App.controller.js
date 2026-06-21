sap.ui.define(
  ["sap/ui/core/mvc/Controller", "sap/m/MessageToast", "sap/m/MessageBox"],
  function (Controller, MessageToast, MessageBox) {
    "use strict";

    return Controller.extend("com.bluestonex.expense.admin.controller.App", {

      onInit: function () {
        this._model = this.getOwnerComponent().getModel();
        this._bindPolicy();
      },

      // ── Policy tab ────────────────────────────────────────────────────────
      _bindPolicy: function () {
        var oList = this._model.bindList("/Policies");
        oList.requestContexts(0, 1).then(function (aCtx) {
          if (aCtx && aCtx.length) {
            this.byId("policyForm").bindElement({ path: aCtx[0].getPath() });
          }
        }.bind(this)).catch(function () { /* ignore */ });
      },

      onSavePolicy: function () {
        this._submit("Policy saved.");
      },

      onCancelPolicy: function () {
        this._model.resetChanges("adminChanges");
        MessageToast.show("Changes discarded.");
      },

      // ── Users tab ─────────────────────────────────────────────────────────
      onCreateUser: function () {
        var oBinding = this.byId("usersTable").getBinding("items");
        oBinding.create({ active: true, role: "Employee", payrollArea: "GB - Central" });
        MessageToast.show("New row added — fill it in and press Save.");
      },

      onDeleteUser: function () {
        var oItem = this.byId("usersTable").getSelectedItem();
        if (!oItem) { MessageToast.show("Select a user to delete."); return; }
        oItem.getBindingContext().delete("$auto").then(function () {
          MessageToast.show("User deleted.");
        }).catch(function (e) { MessageBox.error(e.message || "Delete failed."); });
      },

      onSaveUsers: function () {
        this._submit("Users saved.");
      },

      onCancelUsers: function () {
        this._model.resetChanges("adminChanges");
        this.byId("usersTable").getBinding("items").refresh();
        MessageToast.show("Changes discarded.");
      },

      // ── Audit tab ─────────────────────────────────────────────────────────
      onRefreshAudit: function () {
        this.byId("auditTable").getBinding("items").refresh();
        MessageToast.show("Audit log refreshed.");
      },

      onTabSelect: function (oEvent) {
        if (oEvent.getParameter("key") === "audit") {
          this.byId("auditTable").getBinding("items").refresh();
        }
      },

      // ── Shared submit with error surfacing ────────────────────────────────
      _submit: function (sOkMsg) {
        var oModel = this._model;
        if (!oModel.hasPendingChanges("adminChanges")) {
          MessageToast.show("Nothing to save.");
          return;
        }
        var oMM = sap.ui.getCore().getMessageManager();
        oMM.removeAllMessages();
        oModel.submitBatch("adminChanges").then(function () {
          var aErr = oMM.getMessageModel().getData().filter(function (m) { return m.type === "Error"; });
          if (aErr.length) {
            MessageBox.error(aErr.map(function (m) { return m.message; }).join("\n"));
          } else {
            MessageToast.show(sOkMsg);
          }
        }).catch(function (e) {
          MessageBox.error(e.message || "Save failed.");
        });
      }
    });
  }
);
