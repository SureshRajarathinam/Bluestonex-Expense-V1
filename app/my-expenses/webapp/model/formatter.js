sap.ui.define([], function () {
  "use strict";

  return {
    /** Map statusCriticality (0..3) to a sap.ui.core.ValueState. */
    statusState: function (iCrit) {
      switch (iCrit) {
        case 3: return "Success";   // Approved
        case 2: return "Warning";   // Submitted / FirstApproved
        case 1: return "Error";     // Rejected
        default: return "None";     // Draft
      }
    },

    /** Icon for a claim status (native-Fiori feel). */
    statusIcon: function (sStatus) {
      switch (sStatus) {
        case "Approved": return "sap-icon://accept";
        case "Rejected": return "sap-icon://decline";
        case "Submitted": return "sap-icon://pending";
        case "FirstApproved": return "sap-icon://time-entry-request";
        default: return "sap-icon://edit";
      }
    },

    /** Human-friendly status label. */
    statusText: function (sStatus) {
      switch (sStatus) {
        case "FirstApproved": return "Awaiting 2nd Approval";
        default: return sStatus || "Draft";
      }
    },

    /** Country code -> label. */
    countryText: function (sCode) {
      if (sCode === "IN") return "India";
      if (sCode === "UK") return "United Kingdom";
      return sCode || "";
    },

    /** Format a number as money with the claim currency. */
    money: function (vAmount, sCurrency) {
      var n = Number(vAmount || 0);
      var sym = sCurrency === "INR" ? "₹" : (sCurrency === "GBP" ? "£" : "");
      return sym + n.toFixed(2);
    },

    /**
     * Net/VAT split for the items table. Purely derived (no persistence):
     * while editing a draft it previews the split live from gross + tax type +
     * the country rate; for a saved claim it shows the persisted value. Rounding
     * mirrors srv/lib/calc.js splitVAT (round2 = parseFloat(n.toFixed(2))) so the
     * preview matches what before('SAVE') will store. Server stays authoritative.
     */
    _split: function (vGross, sVatType, vRate) {
      var g = Number(vGross) || 0;
      var r = sVatType === "STD" ? (Number(vRate) || 0) : 0;
      var net = parseFloat((g / (1 + r)).toFixed(2));
      var vat = parseFloat((g - net).toFixed(2));
      return { net: net, vat: vat };
    },

    netPreview: function (vPersisted, vGross, sVatType, vRate, bEditable, sCurrency) {
      var v = bEditable ? this._split(vGross, sVatType, vRate).net : Number(vPersisted || 0);
      return this.money(v, sCurrency);
    },

    vatPreview: function (vPersisted, vGross, sVatType, vRate, bEditable, sCurrency) {
      var v = bEditable ? this._split(vGross, sVatType, vRate).vat : Number(vPersisted || 0);
      return this.money(v, sCurrency);
    },

    /** Receipt attached indicator text. */
    receiptText: function (bAttached, sFileName) {
      return bAttached || sFileName ? "Attached" : "None";
    },

    /** Enable submit only while the claim is a Draft. */
    isDraft: function (sStatus) {
      return !sStatus || sStatus === "Draft";
    },

    /** Show the Edit button only for an active (read-only) Draft claim. */
    canEditDraft: function (bEditable, sStatus) {
      return !bEditable && sStatus === "Draft";
    }
  };
});
