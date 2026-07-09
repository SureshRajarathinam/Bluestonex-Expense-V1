sap.ui.define([
  "com/bluestonex/expense/approval/controller/BaseController",
  "com/bluestonex/expense/approval/model/formatter",
  "sap/ui/model/json/JSONModel"
], function (BaseController, formatter, JSONModel) {
  "use strict";

  var SVC = "/approval";
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function ymd(d) {
    if (!d) { return ""; }
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function money(sym, n) {
    n = Number(n) || 0;
    return sym + n.toLocaleString(sym === "₹" ? "en-IN" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  return BaseController.extend("com.bluestonex.expense.approval.controller.Dashboard", {

    formatter: formatter,

    onInit: function () {
      var today = new Date();
      var from = new Date(); from.setMonth(from.getMonth() - 5); from.setDate(1);
      this._m = new JSONModel({
        from: ymd(from), to: ymd(today), country: "ALL", cur: "£",
        busy: false, hasData: true, error: "", showCurToggle: true, curLabel: "£",
        approvedTotal: 0, approvedSplit: "", rejectedTotal: 0, rejectedSplit: "",
        showGbp: true, showInr: true, reimbursedGbp: money("£", 0), reimbursedInr: money("₹", 0),
        avr: [], cat: [], team: [], trend: [], rangeText: ""
      });
      this.getView().setModel(this._m, "dash");
      this._loaded = false;
    },

    // Called by App.controller.onNavSelect when the tab is shown (and on filter changes).
    onRefresh: function () { this._load(); },

    _load: function () {
      var m = this._m, that = this;
      var url = SVC + "/dashboardStats(fromDate=" + m.getProperty("/from") +
        ",toDate=" + m.getProperty("/to") + ",country='" + m.getProperty("/country") + "')";
      m.setProperty("/busy", true); m.setProperty("/error", "");
      fetch(url, { headers: { Accept: "application/json" }, credentials: "same-origin" })
        .then(function (r) { if (!r.ok) { throw new Error("HTTP " + r.status); } return r.json(); })
        .then(function (j) { that._payload = j; that._loaded = true; that._apply(); m.setProperty("/busy", false); })
        .catch(function () {
          m.setProperty("/busy", false); m.setProperty("/hasData", false);
          m.setProperty("/error", that.getText ? that.getText("dashLoadError") : "Could not load analytics.");
        });
    },

    // Rebuild the display arrays from the last payload (also on currency toggle — no refetch).
    _apply: function () {
      var m = this._m, j = this._payload || {};
      var country = m.getProperty("/country");
      var cur = country === "UK" ? "£" : country === "IN" ? "₹" : m.getProperty("/cur");
      m.setProperty("/curLabel", cur);
      m.setProperty("/showCurToggle", country === "ALL");

      var ap = j.approved || { UK: 0, IN: 0, total: 0 };
      var rj = j.rejected || { UK: 0, IN: 0, total: 0 };
      m.setProperty("/approvedTotal", ap.total || 0);
      m.setProperty("/rejectedTotal", rj.total || 0);
      m.setProperty("/approvedSplit", "UK " + (ap.UK || 0) + " · India " + (ap.IN || 0));
      m.setProperty("/rejectedSplit", "UK " + (rj.UK || 0) + " · India " + (rj.IN || 0));

      var reim = j.reimbursed || { gbp: 0, inr: 0 };
      m.setProperty("/showGbp", country !== "IN");
      m.setProperty("/showInr", country !== "UK");
      m.setProperty("/reimbursedGbp", money("£", reim.gbp));
      m.setProperty("/reimbursedInr", money("₹", reim.inr));

      var avr = [];
      if (country !== "IN") {
        avr.push({ title: "UK Approved", value: ap.UK || 0, color: "Good", displayValue: String(ap.UK || 0) });
        avr.push({ title: "UK Rejected", value: rj.UK || 0, color: "Error", displayValue: String(rj.UK || 0) });
      }
      if (country !== "UK") {
        avr.push({ title: "India Approved", value: ap.IN || 0, color: "Good", displayValue: String(ap.IN || 0) });
        avr.push({ title: "India Rejected", value: rj.IN || 0, color: "Error", displayValue: String(rj.IN || 0) });
      }
      m.setProperty("/avr", avr);

      var pick = function (row) { return cur === "₹" ? (Number(row.inr) || 0) : (Number(row.gbp) || 0); };
      m.setProperty("/cat", (j.spendByCategory || []).map(function (c) {
        var v = pick(c); return { title: c.description || c.code, value: v, color: "Good", displayValue: money(cur, v) };
      }));
      m.setProperty("/team", (j.spendByTeam || []).map(function (t) {
        var v = pick(t);
        return { title: t.department, value: v, color: t.department === "Unassigned" ? "Neutral" : "Good", displayValue: money(cur, v) };
      }));

      var tr = j.trend || [];
      m.setProperty("/trend", tr.map(function (t) {
        var parts = (t.month || "").split("-");
        var lbl = parts.length === 2 ? (MON[(+parts[1]) - 1] + " " + parts[0].slice(2)) : t.month;
        return { title: lbl, value: t.approved || 0, displayValue: (t.approved || 0) + " / " + (t.submitted || 0), color: "Good" };
      }));
      m.setProperty("/rangeText", tr.length ? (tr[0].month + " – " + tr[tr.length - 1].month) : "");

      var has = ((ap.total || 0) + (rj.total || 0) + (j.spendByCategory || []).length) > 0;
      m.setProperty("/hasData", has);
    },

    onDateChange: function (oEvent) {
      var d = oEvent.getSource().getDateValue();
      if (!d) { return; }
      this._m.setProperty(oEvent.getSource().data("edge") === "to" ? "/to" : "/from", ymd(d));
      this._load();
    },
    onCountry: function (oEvent) {
      this._m.setProperty("/country", oEvent.getParameter("item").getKey());
      this._load();
    },
    onCurrency: function (oEvent) {
      this._m.setProperty("/cur", oEvent.getParameter("item").getKey());
      this._apply(); // payload already carries both currencies — no refetch
    }
  });
});
