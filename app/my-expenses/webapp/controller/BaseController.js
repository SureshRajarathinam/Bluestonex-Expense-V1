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
      MessageBox.error(this._backendMessage(oError) || this.getText("errGeneric"));
    },

    /**
     * Extract the human-readable backend message from a failed request.
     *
     * A failed OData V4 *bound action inside a $batch* (Save / Apply for Approval)
     * rejects with the opaque wrapper "HTTP request was not processed because
     * $batch failed" — the real 4xx text (e.g. "a receipt is required…") is
     * delivered separately to the UI5 Message Manager. So: use a specific message
     * carried on the error object when there is one, otherwise fall back to the
     * newest Error-severity message in the model. Plain-fetch failures (receipt
     * PUT) throw their own Error and are returned as-is (no batch wrapper), which
     * avoids surfacing a stale model message.
     */
    _backendMessage: function (oError) {
      // 1) An explicit message on the error object (parsed OData error / manual fetch)
      if (oError && oError.error && oError.error.message) { return oError.error.message; }
      if (oError && oError.message) {
        var m = oError.message.match(/\{[\s\S]*\}/);
        if (m) {
          try { var p = JSON.parse(m[0]); if (p.error && p.error.message) { return p.error.message; } } catch (e) { /* ignore */ }
        }
        // Any non-batch-wrapper message is itself meaningful — surface it directly.
        if (!/\$batch failed/i.test(oError.message)) { return oError.message; }
      }
      // 2) $batch wrapper: the actionable text is in the Message Manager.
      try {
        var aData = (sap.ui.getCore().getMessageManager().getMessageModel().getData() || []).filter(function (msg) {
          return msg && msg.getType && msg.getType() === "Error" && msg.getMessage && msg.getMessage();
        });
        if (aData.length) { return aData[aData.length - 1].getMessage(); }
      } catch (e) { /* fall through to generic */ }
      return "";
    },

    toast: function (sKey) {
      MessageToast.show(this.getText(sKey));
    },

    /**
     * Resolved base URL of the OData service, always ending in "/".
     *
     * Raw fetch() calls (receipt CSRF/PUT/GET) MUST NOT use a literal relative
     * path like "expense/": under the Work Zone managed approuter the app is
     * mounted under a generated prefix, and a relative fetch resolves against
     * document.baseURI (the approuter shell page), not the app mount → 404. The
     * OData V4 model resolves its dataSource uri correctly for that mount, so we
     * borrow its already-resolved service URL as the fetch base.
     */
    _serviceUrl: function () {
      var oModel = this.getOwnerComponent().getModel();
      var sUrl = (oModel && oModel.getServiceUrl && oModel.getServiceUrl()) || "expense/";
      return /\/$/.test(sUrl) ? sUrl : sUrl + "/";
    }
  });
});
