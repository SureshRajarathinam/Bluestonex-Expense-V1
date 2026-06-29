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
    },

    /**
     * Trigger the server-side PDF export (ApprovalService.exportClaimsPdf).
     * sScope: 'approvals' | 'history'. oState: { status, country, claimNo, from, to }.
     */
    exportPdf: function (sScope, oState) {
      var s = oState || {};
      var lit = function (v) { return (v == null || v === "") ? "null" : "'" + String(v).replace(/'/g, "''") + "'"; };
      var dt = function (v) { return v ? v : "null"; };
      var sUrl = "/approval/exportClaimsPdf(" +
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
