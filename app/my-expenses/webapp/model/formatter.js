sap.ui.define([], function () {
  "use strict";

  // Module-scoped helpers. Formatters referenced from an XML view as
  // ".formatter.x" are invoked with `this` bound to the CONTROLLER (not this
  // module), so formatters must NOT rely on `this` to reach each other — they
  // call these closure helpers directly instead.
  // Robust numeric coercion. A freestyle OData V4 amount binding can surface the
  // value as a locale-GROUPED string (e.g. "10,000.00" or "₹10,00,000.00"); a
  // plain Number() of that is NaN, which is what produced "£NaN" totals and a
  // £0.00 net/tax preview for large amounts. Strip anything that isn't a digit,
  // dot or minus (grouping separators, currency symbols, spaces) before parsing.
  // The app is en-GB / en-IN (comma = thousands, dot = decimal), so this is safe.
  function num(v) {
    if (v == null) { return 0; }
    if (typeof v === "number") { return isFinite(v) ? v : 0; }
    var n = Number(String(v).replace(/[^0-9.\-]/g, ""));
    return isFinite(n) ? n : 0;
  }

  function moneyStr(vAmount, sCurrency) {
    var n = num(vAmount);
    var sym = sCurrency === "INR" ? "₹" : (sCurrency === "GBP" ? "£" : "");
    return sym + n.toFixed(2);
  }

  // Net/VAT split for the items table. Rounding mirrors srv/lib/calc.js splitVAT
  // (round2 = parseFloat(n.toFixed(2))) so the live preview matches what
  // before('SAVE') will persist. Server stays authoritative.
  function split(vGross, sVatType, vRate) {
    var g = num(vGross);
    var r = sVatType === "STD" ? num(vRate) : 0;
    var net = parseFloat((g / (1 + r)).toFixed(2));
    var vat = parseFloat((g - net).toFixed(2));
    return { net: net, vat: vat };
  }

  return {
    // Exposed so a controller can reuse the EXACT same numeric coercion +
    // net/VAT split (same rounding as srv/lib/calc.js) when aggregating the
    // live header totals — one source of truth for the money math.
    num: num,
    split: split,

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
        case "Returned": return "sap-icon://undo";
        default: return "sap-icon://edit";
      }
    },

    /** Human-friendly status label. */
    statusText: function (sStatus) {
      switch (sStatus) {
        case "FirstApproved": return "Awaiting 2nd Approval";
        case "Returned": return "Returned for rework";
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
      return moneyStr(vAmount, sCurrency);
    },

    /**
     * Net/VAT preview for the items table. Purely derived (no persistence):
     * while editing a draft it previews the split live from gross + tax type +
     * the country rate; for a saved claim it shows the persisted value.
     * Does not use `this` — see the module-scoped helpers above.
     */
    netPreview: function (vPersisted, vGross, sVatType, vRate, bEditable, sCurrency) {
      var v = bEditable ? split(vGross, sVatType, vRate).net : Number(vPersisted || 0);
      return moneyStr(v, sCurrency);
    },

    vatPreview: function (vPersisted, vGross, sVatType, vRate, bEditable, sCurrency) {
      var v = bEditable ? split(vGross, sVatType, vRate).vat : Number(vPersisted || 0);
      return moneyStr(v, sCurrency);
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
