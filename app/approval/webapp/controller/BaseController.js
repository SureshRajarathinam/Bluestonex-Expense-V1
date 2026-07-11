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
      MessageBox.error(this._backendMessage(oError) || this.getText("errGeneric"));
    },

    /**
     * Extract the human-readable backend message from a failed request.
     *
     * A failed OData V4 bound action inside a $batch (approve / reject) rejects
     * with the opaque wrapper "HTTP request was not processed because $batch
     * failed" — the real 4xx text (e.g. "You are not the configured approver…")
     * is delivered to the UI5 Message Manager instead. Prefer a specific message
     * on the error object; otherwise fall back to the newest Error-severity model
     * message. Plain-fetch failures (PDF export) carry their own message and are
     * returned as-is (no batch wrapper), avoiding a stale model message.
     */
    _backendMessage: function (oError) {
      if (oError && oError.error && oError.error.message) { return oError.error.message; }
      if (oError && oError.message) {
        var m = oError.message.match(/\{[\s\S]*\}/);
        if (m) {
          try { var p = JSON.parse(m[0]); if (p.error && p.error.message) { return p.error.message; } } catch (e) { /* ignore */ }
        }
        if (!/\$batch failed/i.test(oError.message)) { return oError.message; }
      }
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
     * Trigger the server-side PDF export (ApprovalService.exportClaimsPdf).
     * sScope: 'approvals' | 'history'. oState: { status, country, claimNo, from, to }.
     */
    exportPdf: function (sScope, oState) {
      var s = oState || {};
      var lit = function (v) { return (v == null || v === "") ? "null" : "'" + String(v).replace(/'/g, "''") + "'"; };
      var dt = function (v) { return v ? v : "null"; };
      var sUrl = "approval/exportClaimsPdf(" +
        "scope='" + sScope + "'," +
        "status=" + lit(s.status) + "," +
        "country=" + lit(s.country) + "," +
        "claimNo=" + lit(s.claimNo) + "," +
        "fromDate=" + dt(s.from) + "," +
        "toDate=" + dt(s.to) + ")";
      var that = this;
      fetch(encodeURI(sUrl), { headers: { Accept: "application/json" }, credentials: "same-origin" })
        .then(function (r) { if (!r.ok) { throw new Error("PDF export failed (" + r.status + ")"); } return r.json(); })
        .then(function (j) {
          var v = j && j.value;
          var arr;
          if (typeof v === "string") {            // base64 string
            var bin = atob(v);
            arr = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) { arr[i] = bin.charCodeAt(i); }
          } else if (v && v.data) {               // { type:'Buffer', data:[...] }
            arr = new Uint8Array(v.data);
          } else {
            throw new Error("Unexpected PDF payload");
          }
          var oBlob = new Blob([arr], { type: "application/pdf" });
          var oLink = document.createElement("a");
          oLink.href = URL.createObjectURL(oBlob);
          oLink.download = (sScope === "history" ? "claim-history" : "approvals") + ".pdf";
          document.body.appendChild(oLink);
          oLink.click();
          document.body.removeChild(oLink);
        })
        .catch(function (e) { that.showError(e); });
    }
  });
});
