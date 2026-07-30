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

    statusIcon: function (sStatus) {
      switch (sStatus) {
        case "Approved": return "sap-icon://accept";
        case "Rejected": return "sap-icon://decline";
        case "FirstApproved": return "sap-icon://time-entry-request";
        default: return "sap-icon://pending";
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
      // Robust coercion: a freestyle OData V4 amount can arrive as a locale-GROUPED
      // string (e.g. "₹10,00,000.00"); a plain Number() of that is NaN — which
      // rendered "₹NaN" in the Approvals Total for large claims. Strip anything but
      // digits/dot/minus (grouping, currency symbols, spaces) before parsing.
      var n;
      if (vAmount == null) { n = 0; }
      else if (typeof vAmount === "number") { n = isFinite(vAmount) ? vAmount : 0; }
      else { n = Number(String(vAmount).replace(/[^0-9.\-]/g, "")); if (!isFinite(n)) { n = 0; } }
      var sym = sCurrency === "INR" ? "₹" : (sCurrency === "GBP" ? "£" : "");
      // Thousands-grouped, 2dp (e.g. ₹15,617,181.00) so large amounts stay readable.
      return sym + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    /** Look up a label for a key in a plain {key: label} map; fall back to the key.
     *  Used by the Review dialog to render the expense-type description and the
     *  tax-type "CODE (rate%)" label from maps built in Approvals.onReview. */
    lookupText: function (sKey, oMap) {
      return (oMap && oMap[sKey]) || sKey || "";
    }
  };
});
