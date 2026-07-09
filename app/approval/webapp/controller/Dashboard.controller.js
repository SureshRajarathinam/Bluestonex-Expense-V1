sap.ui.define([
  "com/bluestonex/expense/approval/controller/BaseController",
  "com/bluestonex/expense/approval/model/formatter",
  "sap/ui/model/json/JSONModel"
], function (BaseController, formatter, JSONModel) {
  "use strict";

  var SVC = "/approval";
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var LKEY = "bsx.dash.layout.v1"; // localStorage key for the user's custom card order

  function ymd(d) {
    if (!d) { return ""; }
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function money(sym, n) {
    n = Number(n) || 0;
    return sym + n.toLocaleString(sym === "₹" ? "en-IN" : "en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c];
    });
  }
  function pct(v, max) { return Math.max(0, Math.round((v / (max || 1)) * 100)); }

  // ── Chart-body builders (return a single-root HTML string) ──────────────────
  // Grouped VERTICAL bars: Approved (green) vs Rejected (red), per country group.
  function avrChart(groups) {
    if (!groups.length) { return ""; }
    var max = 1;
    groups.forEach(function (g) { max = Math.max(max, g.approved, g.rejected); });
    var legend =
      "<div class='bsxLegend'>" +
        "<span><i class='bsxDot bsxDot--ok'></i>Approved</span>" +
        "<span><i class='bsxDot bsxDot--no'></i>Rejected</span>" +
      "</div>";
    var bars = groups.map(function (g) {
      return "<div class='bsxVGroup'>" +
        "<div class='bsxVBars'>" +
          "<div class='bsxVCol'><span class='bsxVVal'>" + g.approved + "</span>" +
            "<div class='bsxVBar bsxVBar--ok' style='height:" + pct(g.approved, max) + "%'></div></div>" +
          "<div class='bsxVCol'><span class='bsxVVal'>" + g.rejected + "</span>" +
            "<div class='bsxVBar bsxVBar--no' style='height:" + pct(g.rejected, max) + "%'></div></div>" +
        "</div>" +
        "<div class='bsxVLabel'>" + esc(g.label) + "</div>" +
      "</div>";
    }).join("");
    return "<div class='bsxChart'>" + legend + "<div class='bsxVChart'>" + bars + "</div></div>";
  }

  // Horizontal tracked bars: label · fill-on-track · value.
  function hBars(rows, cur, mod) {
    if (!rows.length) { return ""; }
    var max = 1;
    rows.forEach(function (r) { max = Math.max(max, r.value); });
    var body = rows.map(function (r) {
      return "<div class='bsxHRow'>" +
        "<span class='bsxHLabel'>" + esc(r.title) + "</span>" +
        "<span class='bsxHTrack'><span class='bsxHFill " + (r.mod || mod || "") + "' style='width:" + pct(r.value, max) + "%'></span></span>" +
        "<span class='bsxHVal'>" + money(cur, r.value) + "</span>" +
      "</div>";
    }).join("");
    return "<div class='bsxHBars'>" + body + "</div>";
  }

  // Grouped VERTICAL columns per month: Submitted (light-blue) vs Approved (green).
  function trendChart(rows) {
    if (!rows.length) { return ""; }
    var max = 1;
    rows.forEach(function (r) { max = Math.max(max, r.submitted, r.approved); });
    var legend =
      "<div class='bsxLegend'>" +
        "<span><i class='bsxDot bsxDot--sub'></i>Submitted</span>" +
        "<span><i class='bsxDot bsxDot--ok'></i>Approved</span>" +
      "</div>";
    var bars = rows.map(function (r) {
      return "<div class='bsxVGroup'>" +
        "<div class='bsxVBars'>" +
          "<div class='bsxVCol'><div class='bsxVBar bsxVBar--sub' style='height:" + pct(r.submitted, max) + "%'></div></div>" +
          "<div class='bsxVCol'><div class='bsxVBar bsxVBar--ok' style='height:" + pct(r.approved, max) + "%'></div></div>" +
        "</div>" +
        "<div class='bsxVLabel'>" + esc(r.label) + "</div>" +
      "</div>";
    }).join("");
    return "<div class='bsxChart'>" + legend + "<div class='bsxVChart bsxVChart--trend'>" + bars + "</div></div>";
  }

  // Rounded UK/India split pills for a KPI tile (respects the country filter).
  function pills(country, uk, inn) {
    var out = "";
    if (country !== "IN") { out += "<span class='bsxPill bsxPill--uk'>UK " + uk + "</span>"; }
    if (country !== "UK") { out += "<span class='bsxPill bsxPill--in'>India " + inn + "</span>"; }
    return "<div class='bsxPills'>" + out + "</div>";
  }

  return BaseController.extend("com.bluestonex.expense.approval.controller.Dashboard", {

    formatter: formatter,

    onInit: function () {
      var today = new Date();
      var from = new Date(); from.setMonth(from.getMonth() - 5); from.setDate(1);
      this._m = new JSONModel({
        from: ymd(from), to: ymd(today), country: "ALL", cur: "£",
        busy: false, hasData: true, error: "", showCurToggle: true, curLabel: "£", rangeText: "",
        awaitingTotal: 0, awaitingPills: "",
        approvedTotal: 0, approvedPills: "", rejectedTotal: 0, rejectedPills: "",
        showGbp: true, showInr: true, reimbursedGbp: money("£", 0), reimbursedInr: money("₹", 0),
        avrHtml: "", catHtml: "", teamHtml: "", trendHtml: ""
      });
      this.getView().setModel(this._m, "dash");
      this._loaded = false;
      this._load(); // Dashboard is the landing tab — fetch on startup.
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

    // Rebuild the display arrays/HTML from the last payload (also on currency toggle — no refetch).
    _apply: function () {
      var m = this._m, j = this._payload || {};
      var country = m.getProperty("/country");
      var cur = country === "UK" ? "£" : country === "IN" ? "₹" : m.getProperty("/cur");
      m.setProperty("/curLabel", cur);
      m.setProperty("/showCurToggle", country === "ALL");
      m.setProperty("/rangeText", this._rangeText());

      var aw = j.awaiting || { UK: 0, IN: 0, total: 0 };
      var ap = j.approved || { UK: 0, IN: 0, total: 0 };
      var rj = j.rejected || { UK: 0, IN: 0, total: 0 };
      m.setProperty("/awaitingTotal", aw.total || 0);
      m.setProperty("/approvedTotal", ap.total || 0);
      m.setProperty("/rejectedTotal", rj.total || 0);
      m.setProperty("/awaitingPills", pills(country, aw.UK || 0, aw.IN || 0));
      m.setProperty("/approvedPills", pills(country, ap.UK || 0, ap.IN || 0));
      m.setProperty("/rejectedPills", pills(country, rj.UK || 0, rj.IN || 0));

      var reim = j.reimbursed || { gbp: 0, inr: 0 };
      m.setProperty("/showGbp", country !== "IN");
      m.setProperty("/showInr", country !== "UK");
      m.setProperty("/reimbursedGbp", money("£", reim.gbp));
      m.setProperty("/reimbursedInr", money("₹", reim.inr));

      // Approved vs Rejected — grouped vertical bars per country in scope.
      var groups = [];
      if (country !== "IN") { groups.push({ label: "UK", approved: ap.UK || 0, rejected: rj.UK || 0 }); }
      if (country !== "UK") { groups.push({ label: "India", approved: ap.IN || 0, rejected: rj.IN || 0 }); }
      m.setProperty("/avrHtml", avrChart(groups));

      var pick = function (row) { return cur === "₹" ? (Number(row.inr) || 0) : (Number(row.gbp) || 0); };
      var cat = (j.spendByCategory || []).map(function (c) {
        return { title: c.description || c.code, value: pick(c) };
      }).filter(function (r) { return r.value > 0; });
      var team = (j.spendByTeam || []).map(function (t) {
        return { title: t.department, value: pick(t), mod: t.department === "Unassigned" ? "bsxHFill--muted" : "" };
      }).filter(function (r) { return r.value > 0; });
      m.setProperty("/catHtml", hBars(cat, cur, "bsxHFill--blue"));
      m.setProperty("/teamHtml", hBars(team, cur, "bsxHFill--violet"));

      var tr = (j.trend || []).map(function (t) {
        var parts = (t.month || "").split("-");
        var lbl = parts.length === 2 ? MON[(+parts[1]) - 1] : t.month;
        return { label: lbl, submitted: t.submitted || 0, approved: t.approved || 0 };
      });
      m.setProperty("/trendHtml", trendChart(tr));

      var has = ((ap.total || 0) + (rj.total || 0) + (aw.total || 0) + cat.length) > 0;
      m.setProperty("/hasData", has);
    },

    // "Feb – Jul 2026 · 6 months" from the selected range.
    _rangeText: function () {
      var m = this._m;
      var f = new Date(m.getProperty("/from")), t = new Date(m.getProperty("/to"));
      if (isNaN(f) || isNaN(t)) { return ""; }
      var months = (t.getFullYear() - f.getFullYear()) * 12 + (t.getMonth() - f.getMonth()) + 1;
      var head = MON[f.getMonth()] + (f.getFullYear() !== t.getFullYear() ? " " + f.getFullYear() : "") +
        " – " + MON[t.getMonth()] + " " + t.getFullYear();
      return head + " · " + months + " month" + (months === 1 ? "" : "s");
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
    },

    // ── Drag-and-drop card personalisation (persisted to localStorage) ───────
    // On first render, capture the markup default, then apply any saved order.
    onAfterRendering: function () {
      if (!this.byId("dashRow0")) { return; }
      if (!this._defaultLayout) { this._defaultLayout = this._readLayout(); }
      if (this._layoutApplied) { return; }
      this._layoutApplied = true;
      var saved = null;
      try { saved = JSON.parse(window.localStorage.getItem(LKEY) || "null"); } catch (e) { saved = null; }
      if (saved) { this._applyLayout(saved); }
    },

    _rows: function () { return [this.byId("dashRow0"), this.byId("dashRow1"), this.byId("dashRow2")]; },

    // Current layout as an array (per row) of card keys.
    _readLayout: function () {
      return this._rows().map(function (r) {
        return r ? r.getItems().map(function (it) { return it.data("card"); }) : [];
      });
    },

    // Move cards into the rows/order described by `layout` (keys not found are skipped).
    _applyLayout: function (layout) {
      var rows = this._rows(), byKey = {};
      rows.forEach(function (r) {
        if (r) { r.getItems().forEach(function (it) { byKey[it.data("card")] = it; }); }
      });
      layout.forEach(function (keys, ri) {
        var row = rows[ri];
        if (!row || !keys) { return; }
        keys.forEach(function (k, idx) {
          var c = byKey[k];
          if (c) {
            var p = c.getParent();
            if (p) { p.removeItem(c); }
            row.insertItem(c, idx);
          }
        });
      });
    },

    onCardDrop: function (oEvent) {
      var oDragged = oEvent.getParameter("draggedControl");
      var oDropped = oEvent.getParameter("droppedControl");
      if (!oDragged || oDragged === oDropped) { return; }
      var sPos = oEvent.getParameter("dropPosition"); // Before | After
      var oTarget = oDropped ? oDropped.getParent() : oEvent.getSource().getParent();
      var oSource = oDragged.getParent();
      if (oSource) { oSource.removeItem(oDragged); }
      var iIdx = oDropped ? oTarget.indexOfItem(oDropped) + (sPos === "After" ? 1 : 0) : oTarget.getItems().length;
      oTarget.insertItem(oDragged, iIdx);
      this._saveLayout();
    },

    _saveLayout: function () {
      try { window.localStorage.setItem(LKEY, JSON.stringify(this._readLayout())); } catch (e) { /* storage off — ignore */ }
    },

    onResetLayout: function () {
      try { window.localStorage.removeItem(LKEY); } catch (e) { /* ignore */ }
      if (this._defaultLayout) { this._applyLayout(this._defaultLayout); }
    }
  });
});
