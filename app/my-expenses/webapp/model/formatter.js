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
