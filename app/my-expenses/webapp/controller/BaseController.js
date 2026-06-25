sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/core/UIComponent",
  "sap/m/MessageBox",
  "sap/m/MessageToast"
], function (Controller, UIComponent, MessageBox, MessageToast) {
  "use strict";

  return Controller.extend("com.bluestonex.expense.myexpenses.controller.BaseController", {

    getRouter: function () {
      return UIComponent.getRouterFor(this);
    },

    getModel: function (sName) {
      return this.getOwnerComponent().getModel(sName);
    },

    getText: function (sKey, aArgs) {
      return this.getOwnerComponent().getModel("i18n").getResourceBundle().getText(sKey, aArgs);
    },

    navTo: function (sRoute, oParams) {
      this.getRouter().navTo(sRoute, oParams);
    },

    /**
     * Execute an OData V4 bound action and return the (optional) result context.
     * @param {sap.ui.model.odata.v4.Context} oContext  bound entity context
     * @param {string} sAction  fully-qualified action name (e.g. ExpenseService.submitClaim)
     * @param {object} [mParams]  action parameter values
     * @param {object} [mOpts]  { $$inheritExpandSelect: true }
     */
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

    /** Standardised error popup that surfaces backend 4xx messages. */
    showError: function (oError) {
      var sMsg = this.getText("errGeneric");
      try {
        if (oError && oError.error && oError.error.message) {
          sMsg = oError.error.message;
        } else if (oError && oError.message) {
          // OData V4 wraps the server payload in error.message as JSON sometimes
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
