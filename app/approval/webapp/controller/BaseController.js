sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageBox",
  "sap/m/MessageToast"
], function (Controller, MessageBox, MessageToast) {
  "use strict";

  return Controller.extend("com.bluestonex.expense.approval.controller.BaseController", {

    getModel: function (sName) {
      return this.getOwnerComponent().getModel(sName);
    },

    getText: function (sKey, aArgs) {
      return this.getOwnerComponent().getModel("i18n").getResourceBundle().getText(sKey, aArgs);
    },

    /** Execute an OData V4 bound action; resolves with the bound result context. */
    callAction: function (oContext, sAction, mParams, mOpts) {
      var oModel = oContext.getModel();
      var oOperation = oModel.bindContext(sAction + "(...)", oContext, mOpts || {});
      Object.keys(mParams || {}).forEach(function (k) {
        oOperation.setParameter(k, mParams[k]);
      });
      return oOperation.execute().then(function () {
        return oOperation.getBoundContext();
      });
    },

    showError: function (oError) {
      var sMsg = this.getText("errGeneric");
      try {
        if (oError && oError.error && oError.error.message) {
          sMsg = oError.error.message;
        } else if (oError && oError.message) {
          var m = oError.message.match(/\{[\s\S]*\}/);
          if (m) {
            var parsed = JSON.parse(m[0]);
            sMsg = (parsed.error && parsed.error.message) || oError.message;
          } else {
            sMsg = oError.message;
          }
        }
      } catch (e) { /* keep generic */ }
      MessageBox.error(sMsg);
    },

    toast: function (sKey) {
      MessageToast.show(this.getText(sKey));
    }
  });
});
