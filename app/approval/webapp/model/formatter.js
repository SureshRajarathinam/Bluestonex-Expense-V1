sap.ui.define([], function () {
  "use strict";

  return {
    statusState: function (iCrit) {
      switch (iCrit) {
        case 3: return "Success";
        case 2: return "Warning";
        case 1: return "Error";
        default: return "None";
      }
    },

    statusText: function (sStatus) {
      switch (sStatus) {
        case "FirstApproved": return "Awaiting 2nd Approval";
        case "Submitted": return "Awaiting Approval";
        default: return sStatus || "";
      }
    },

    countryText: function (sCode) {
      if (sCode === "IN") return "India";
      if (sCode === "UK") return "United Kingdom";
      return sCode || "";
    },

    /** Which level is pending, for the approver's context line. */
    levelText: function (sCountry, sStatus) {
      if (sCountry === "IN") return "India · single-level approval";
      if (sStatus === "Submitted") return "United Kingdom · 1st-level approval";
      if (sStatus === "FirstApproved") return "United Kingdom · 2nd-level approval";
      return "";
    },

    money: function (vAmount, sCurrency) {
      var n = Number(vAmount || 0);
      var sym = sCurrency === "INR" ? "₹" : (sCurrency === "GBP" ? "£" : "");
      return sym + n.toFixed(2);
    },

    /** Download URL for an item's receipt (active, non-draft projection). */
    receiptHref: function (sItemId) {
      return sItemId ? "/approval/ApprovalItems(" + sItemId + ")/receipt" : "";
    },

    /** True only for the UK workflow row (enables the 2nd-level approver field). */
    isUK: function (sCountry) {
      return sCountry === "UK";
    }
  };
});
