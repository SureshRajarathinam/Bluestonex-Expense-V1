sap.ui.define([
  "com/bluestonex/expense/approval/controller/BaseController",
  "com/bluestonex/expense/approval/model/formatter",
  "sap/ui/model/json/JSONModel",
  "sap/m/ResponsivePopover",
  "sap/m/VBox",
  "sap/m/Text"
], function (BaseController, formatter, JSONModel, ResponsivePopover, VBox, MText) {
  "use strict";

  var SVC = "/approval";
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var LKEY = "bsx.dash.layout.v2"; // localStorage key; bumped (card set changed: reim tiles removed, Top Expense Items added)

  // Categorical palette for the Top Expense Items donut (matches the reference: a
  // pastel wheel, one colour per expense category, cycled if there are more types).
  var DONUT_COLORS = [
    "#9ed9c0", "#4caf93", "#b9c9f0", "#5b8def", "#f5bcd6", "#ec5a8d",
    "#f6cf9a", "#ef9b3b", "#bfe6e6", "#3fa5a5", "#f0e3a2", "#c9b6e8"
  ];

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

  // Geographic card: ISO alpha-2 → display name, tier colours, static legend.
  var GEO_NAMES = { GB: "United Kingdom", IN: "India" };
  var GEO_LEGEND_HTML =
    "<div class='bsxLegend bsxCardPad'>" +
      "<span><i class='bsxDot' style='background:#1b3fae'></i>High</span>" +
      "<span><i class='bsxDot' style='background:#4a90e2'></i>Medium</span>" +
      "<span><i class='bsxDot' style='background:#a9c8f0'></i>Low</span>" +
      "<span><i class='bsxDot' style='background:#e4e8ec'></i>No activity</span>" +
    "</div>";
  // Shade tier from approved count (relative to the max in the current result set).
  function geoTier(n, max) {
    var r = (n || 0) / (max || 1);
    return r > 0.66 ? "rgba(27,63,174,1)" : r > 0.33 ? "rgba(74,144,226,1)" : "rgba(169,200,240,1)";
  }
  // Inline fallback (only used if AnalyticMap renders blank): a compact per-country
  // summary shaded by the same tier, currency-native — driven by the SAME /geo data.
  function geoChart(rows, max) {
    if (!rows.length) { return ""; }
    var body = rows.map(function (r) {
      var sym = r.code === "IN" ? "₹" : "£";
      var amt = r.code === "IN" ? r.inr : r.gbp;
      return "<div class='bsxHRow'>" +
        "<span class='bsxHLabel'><i class='bsxDot' style='background:" + geoTier(r.approved, max) + "'></i>" +
          esc(GEO_NAMES[r.code] || r.country || r.code) + "</span>" +
        "<span class='bsxHVal'>" + (r.approved || 0) + " approved · " + money(sym, amt) + "</span>" +
      "</div>";
    }).join("");
    return "<div class='bsxHBars'>" + body + "</div>";
  }

  // ── Chart-body builders (return a single-root HTML string) ──────────────────
  // Grouped VERTICAL bars: Approved (blue) vs Returned (black), per country group.
  // `rejected` field carries the decline count (returned-for-rework + legacy).
  function avrChart(groups) {
    if (!groups.length) { return ""; }
    var max = 1;
    groups.forEach(function (g) { max = Math.max(max, g.approved, g.rejected); });
    var legend =
      "<div class='bsxLegend'>" +
        "<span><i class='bsxDot bsxDot--ok'></i>Approved</span>" +
        "<span><i class='bsxDot bsxDot--no'></i>Returned</span>" +
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

  // Top Expense Items donut: a conic-gradient ring (one slice per category) with
  // the grand total Amount in the centre + a colour-keyed legend. Native currency
  // for the active scope (no cross-currency sum). Zero new library — pure HTML/CSS.
  function donutChart(rows, cur, amountLabel) {
    var data = rows.filter(function (r) { return r.value > 0; });
    if (!data.length) { return "<div class='bsxTlEmpty bsxCardPad'>No expense items for the selected filters.</div>"; }
    var total = data.reduce(function (s, r) { return s + r.value; }, 0);
    var acc = 0, stops = [], legend = "";
    data.forEach(function (r, i) {
      var col = DONUT_COLORS[i % DONUT_COLORS.length];
      var start = (acc / total) * 100, end = ((acc + r.value) / total) * 100;
      stops.push(col + " " + start.toFixed(3) + "% " + end.toFixed(3) + "%");
      acc += r.value;
      legend += "<span class='bsxDonutLeg'><i class='bsxDonutDot' style='background:" + col + "'></i>" + esc(r.title) + "</span>";
    });
    return "<div class='bsxDonut'>" +
      "<div class='bsxDonutRingWrap'>" +
        "<div class='bsxDonutRing' style='background:conic-gradient(" + stops.join(",") + ")'></div>" +
        "<div class='bsxDonutHole'>" +
          "<div class='bsxDonutNum'>" + money(cur, total) + "</div>" +
          "<div class='bsxDonutLbl'>" + esc(amountLabel || "Amount") + "</div>" +
        "</div>" +
      "</div>" +
      "<div class='bsxDonutLegend'>" + legend + "</div>" +
    "</div>";
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
        fromDate: from, toDate: today, preset: "", country: "ALL", cur: "£",
        busy: false, hasData: true, error: "", showCurToggle: true, curLabel: "£", rangeText: "",
        awaitingTotal: 0, awaitingPills: "",
        approvedTotal: 0, approvedPills: "", rejectedTotal: 0, rejectedPills: "",
        avrHtml: "", catHtml: "", donutHtml: "", trendHtml: "",
        geo: [], geoLegendHtml: GEO_LEGEND_HTML, geoSvgHtml: ""
      });
      this.getView().setModel(this._m, "dash");
      this._loaded = false;
      this._load(); // Dashboard is the landing tab — fetch on startup.
    },

    // Called by App.controller.onNavSelect when the tab is shown (and on filter changes).
    onRefresh: function () { this._load(); },

    _load: function () {
      var m = this._m, that = this;
      var url = SVC + "/dashboardStats(fromDate=" + ymd(m.getProperty("/fromDate")) +
        ",toDate=" + ymd(m.getProperty("/toDate")) + ",country='" + m.getProperty("/country") + "')";
      m.setProperty("/busy", true); m.setProperty("/error", "");
      // cache:'no-store' — always pull the live aggregation; never let the browser
      // replay a stale cached dashboardStats response (every card, incl. the
      // Top Expense Items donut, reflects the current claims on each load/filter).
      fetch(url, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" })
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

      // Approved vs Rejected — grouped vertical bars per country in scope.
      var groups = [];
      if (country !== "IN") { groups.push({ label: "UK", approved: ap.UK || 0, rejected: rj.UK || 0 }); }
      if (country !== "UK") { groups.push({ label: "India", approved: ap.IN || 0, rejected: rj.IN || 0 }); }
      m.setProperty("/avrHtml", avrChart(groups));

      var pick = function (row) { return cur === "₹" ? (Number(row.inr) || 0) : (Number(row.gbp) || 0); };
      var cat = (j.spendByCategory || []).map(function (c) {
        return { title: c.description || c.code, value: pick(c) };
      }).filter(function (r) { return r.value > 0; });
      m.setProperty("/catHtml", hBars(cat, cur, "bsxHFill--blue"));

      // Top Expense Items donut — all expense items by category, in the active
      // currency; the centre shows the total Amount (sum of the slices).
      var exp = (j.expenseItems || []).map(function (c) { return { title: c.description || c.code, value: pick(c) }; });
      m.setProperty("/donutHtml", donutChart(exp, cur, this.getText ? this.getText("dashAmount") : "Amount"));

      // Spend by country — shade each region by approved count (currency-agnostic;
      // native-currency spend rides in the tooltip). Country filter already scoped it.
      var geoRows = j.spendByCountry || [];
      var gmax = geoRows.reduce(function (mx, r) { return Math.max(mx, r.approved || 0); }, 0);
      m.setProperty("/geo", geoRows.map(function (r) {
        var sym = r.code === "IN" ? "₹" : "£";
        var amt = r.code === "IN" ? r.inr : r.gbp;
        return {
          code: r.code,
          color: geoTier(r.approved, gmax),
          tooltip: (GEO_NAMES[r.code] || r.country) + " · " + money(sym, amt) + " · " + (r.approved || 0) + " approved",
          name: GEO_NAMES[r.code] || r.country || r.code,
          spendText: money(sym, amt),
          claims: r.claims || 0
        };
      }));
      m.setProperty("/geoSvgHtml", geoChart(geoRows, gmax)); // fallback body (see view comment)

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
      var f = m.getProperty("/fromDate"), t = m.getProperty("/toDate");
      if (!f || !t || isNaN(f) || isNaN(t)) { return ""; }
      var months = (t.getFullYear() - f.getFullYear()) * 12 + (t.getMonth() - f.getMonth()) + 1;
      var head = MON[f.getMonth()] + (f.getFullYear() !== t.getFullYear() ? " " + f.getFullYear() : "") +
        " – " + MON[t.getMonth()] + " " + t.getFullYear();
      return head + " · " + months + " month" + (months === 1 ? "" : "s");
    },

    // Rolling quick-ranges (each ending today): Day / Week(7d) / Month(30d) / Year(365d).
    onPreset: function (oEvent) {
      var key = oEvent.getParameter("item").getKey();
      var to = new Date(), from = new Date();
      if (key === "W") { from.setDate(to.getDate() - 6); }
      else if (key === "M") { from.setDate(to.getDate() - 29); }
      else if (key === "Y") { from.setDate(to.getDate() - 364); }
      // "D" → from = to = today
      this._m.setProperty("/fromDate", from);
      this._m.setProperty("/toDate", to);
      this._load();
    },
    onRange: function (oEvent) {
      var d1 = oEvent.getParameter("from") || oEvent.getSource().getDateValue();
      var d2 = oEvent.getParameter("to") || oEvent.getSource().getSecondDateValue();
      if (!d1 || !d2) { return; }
      this._m.setProperty("/preset", ""); // a manual range clears the preset selection
      this._m.setProperty("/fromDate", d1);
      this._m.setProperty("/toDate", d2);
      this._load();
    },
    onCountry: function (oEvent) {
      this._m.setProperty("/country", oEvent.getSource().getSelectedKey());
      this._load();
    },
    onCurrency: function (oEvent) {
      this._m.setProperty("/cur", oEvent.getSource().getSelectedKey());
      this._apply(); // payload already carries both currencies — no refetch
    },

    // Geo region click → popover with country · native-currency spend · claims.
    onRegionClick: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext("dash");
      var d = oCtx && oCtx.getObject();
      if (!d) { return; }
      if (!this._geoPop) {
        this._geoPopModel = new JSONModel({});
        this._geoPop = new ResponsivePopover({
          placement: "Auto", showHeader: true, contentWidth: "16rem",
          title: "{dashPop>/name}",
          content: [ new VBox({ items: [
            new MText({ text: "{dashPop>/spendText}" }).addStyleClass("bsxPopSpend sapUiTinyMargin"),
            new MText({ text: "{dashPop>/claimsText}" }).addStyleClass("bsxKpiSub sapUiTinyMarginBegin sapUiTinyMarginBottom")
          ] }) ]
        });
        this._geoPop.setModel(this._geoPopModel, "dashPop");
        this.getView().addDependent(this._geoPop);
      }
      this._geoPopModel.setData({
        name: d.name || d.code,
        spendText: d.spendText || "",
        claimsText: (d.claims || 0) + " " + (this.getText ? this.getText("dashGeoClaims") : "claims")
      });
      this._geoPop.openBy(this.byId("geoMap"));
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
