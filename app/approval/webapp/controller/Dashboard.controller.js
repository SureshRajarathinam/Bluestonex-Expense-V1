sap.ui.define([
  "com/bluestonex/expense/approval/controller/BaseController",
  "com/bluestonex/expense/approval/model/formatter",
  "sap/ui/model/json/JSONModel",
  "sap/m/ResponsivePopover",
  "sap/m/VBox",
  "sap/m/Text"
], function (BaseController, formatter, JSONModel, ResponsivePopover, VBox, MText) {
  "use strict";

  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var LKEY = "bsx.dash.layout.v3"; // localStorage key; bumped (card set changed: avr → Top 5 claimants)

  // Rich categorical palette taken from the Outbound-Processing dashboard reference:
  // rich blue · emerald · coral · navy · purple, then more distinct rich hues,
  // cycled if there are more expense categories than colours.
  var DONUT_COLORS = [
    "#4c8bf5", "#2e9e6b", "#e0574f", "#2f3345", "#7c5cff", "#f0ab00",
    "#17a2b8", "#e0508c", "#2f6fd6", "#8bc34a", "#00b8a9", "#9c6ade"
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

  // Geographic card: ISO alpha-2 → display name, tier colours.
  var GEO_NAMES = { GB: "United Kingdom", IN: "India" };
  // Card footer: a concise, relevant summary of the in-scope country (spend · claims
  // · approved · returned) — replaces the old High/Medium/Low shading legend, which
  // was meaningless for a single-country view.
  function geoFooter(rows) {
    if (!rows.length) { return ""; }
    var items = rows.map(function (r) {
      var sym = r.code === "IN" ? "₹" : "£";
      var amt = r.code === "IN" ? r.inr : r.gbp;
      return "<span><b>" + esc(GEO_NAMES[r.code] || r.country || r.code) + "</b> · " +
        money(sym, amt) + " approved spend · " +
        (r.claims || 0) + " claims · " + (r.approved || 0) + " approved · " +
        (r.rejected || 0) + " returned</span>";
    }).join("");
    return "<div class='bsxCardFoot bsxGeoFoot'>" + items + "</div>";
  }
  // Shade tier from approved count (relative to the max in the current result set).
  function geoTier(n, max) {
    var r = (n || 0) / (max || 1);
    // Rich blue family from the reference (dark #2f6fd6 · mid #4c8bf5 · light #a9c7f7).
    return r > 0.66 ? "rgba(47,111,214,1)" : r > 0.33 ? "rgba(76,139,245,1)" : "rgba(169,199,247,1)";
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
  // Rich-blue shade by rank (hue ~ the reference "Created" blue #4c8bf5): darkest
  // for the top claimant, lightening down the list (lightness ramps 44% → 74%).
  function blueShade(rank, total) {
    var ratio = total > 1 ? rank / (total - 1) : 0;
    return "hsl(219, 88%, " + Math.round(44 + ratio * 30) + "%)";
  }

  // Top 5 claimants: horizontal bars — name (left) · blue-shaded bar · amount
  // (right). Bar length is proportional to the amount; colour shade by rank.
  function claimantsChart(rows, cur) {
    if (!rows.length) { return "<div class='bsxTlEmpty bsxCardPad'>No claimants for the selected filters.</div>"; }
    var max = 1;
    rows.forEach(function (r) { max = Math.max(max, r.value); });
    var body = rows.map(function (r, i) {
      return "<div class='bsxHRow'>" +
        "<span class='bsxHLabel'>" + esc(r.name) + "</span>" +
        "<span class='bsxHTrack'><span class='bsxHFill' style='width:" + pct(r.value, max) + "%;background:" + blueShade(i, rows.length) + "'></span></span>" +
        "<span class='bsxHVal'>" + money(cur, r.value) + "</span>" +
      "</div>";
    }).join("");
    return "<div class='bsxHBars'>" + body + "</div>";
  }

  // Amount-driven heat colour: green (lowest) → amber → red (highest), by the
  // bar's value relative to the largest in the set. hue 120°=green … 0°=red.
  function heatColor(value, max) {
    var ratio = Math.max(0, Math.min(1, (Number(value) || 0) / (max || 1)));
    return "hsl(" + Math.round(120 * (1 - ratio)) + ", 68%, 45%)";
  }

  // Horizontal tracked bars: label · fill-on-track · value. The fill colour is
  // set dynamically from the amount (heat scale), so bigger spend stands out.
  function hBars(rows, cur) {
    if (!rows.length) { return ""; }
    var max = 1;
    rows.forEach(function (r) { max = Math.max(max, r.value); });
    var body = rows.map(function (r) {
      return "<div class='bsxHRow'>" +
        "<span class='bsxHLabel'>" + esc(r.title) + "</span>" +
        "<span class='bsxHTrack'><span class='bsxHFill' style='width:" + pct(r.value, max) + "%;background:" + heatColor(r.value, max) + "'></span></span>" +
        "<span class='bsxHVal'>" + money(cur, r.value) + "</span>" +
      "</div>";
    }).join("");
    // Compact gradient legend so the colour→amount encoding is explicit.
    var legend = "<div class='bsxHeatLegend'>" +
      "<span>Lower spend</span><span class='bsxHeatBar'></span><span>Higher spend</span>" +
    "</div>";
    return "<div class='bsxHBars'>" + body + legend + "</div>";
  }

  // Grouped VERTICAL columns per month: Submitted (light-blue) · Approved (green)
  // · Returned (red). `rejected` carries the decline count (returned + legacy).
  function trendChart(rows) {
    if (!rows.length) { return ""; }
    var max = 1;
    rows.forEach(function (r) { max = Math.max(max, r.submitted, r.approved, r.rejected); });
    var legend =
      "<div class='bsxLegend'>" +
        "<span><i class='bsxDot bsxDot--sub'></i>Submitted</span>" +
        "<span><i class='bsxDot bsxDot--ok'></i>Approved</span>" +
        "<span><i class='bsxDot bsxDot--no'></i>Returned</span>" +
      "</div>";
    var bars = rows.map(function (r) {
      return "<div class='bsxVGroup'>" +
        "<div class='bsxVBars'>" +
          "<div class='bsxVCol'><div class='bsxVBar bsxVBar--sub' style='height:" + pct(r.submitted, max) + "%'></div></div>" +
          "<div class='bsxVCol'><div class='bsxVBar bsxVBar--ok' style='height:" + pct(r.approved, max) + "%'></div></div>" +
          "<div class='bsxVCol'><div class='bsxVBar bsxVBar--no' style='height:" + pct(r.rejected, max) + "%'></div></div>" +
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
    // SVG stroked-circle donut: one arc per category. Each arc carries a native
    // <title>, so hovering a slice pops up "Category — amount (percent)" — the
    // percentage lives in the popup, not in the legend below.
    var R = 78, C = 2 * Math.PI * R, acc = 0, arcs = "", legend = "";
    data.forEach(function (r, i) {
      var col = DONUT_COLORS[i % DONUT_COLORS.length];
      var dash = (r.value / total) * C;
      var share = total ? (r.value / total) * 100 : 0;
      var tip = esc(r.title) + " — " + money(cur, r.value) + " (" + share.toFixed(1) + "%)";
      arcs += "<circle class='bsxDonutArc' cx='100' cy='100' r='" + R + "' fill='none' stroke='" + col +
        "' stroke-width='26' stroke-dasharray='" + dash.toFixed(3) + " " + (C - dash).toFixed(3) +
        "' stroke-dashoffset='" + (-acc).toFixed(3) + "'><title>" + tip + "</title></circle>";
      acc += dash;
      legend += "<span class='bsxDonutLeg'><i class='bsxDonutDot' style='background:" + col + "'></i>" + esc(r.title) + "</span>";
    });
    return "<div class='bsxDonut'>" +
      "<div class='bsxDonutRingWrap'>" +
        "<svg class='bsxDonutSvg' viewBox='0 0 200 200'><g transform='rotate(-90 100 100)'>" + arcs + "</g></svg>" +
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
      // Default window = the FULL current calendar year (Jan 1 – Dec 31) so the
      // Trend and every metric span every month that has claim-period records —
      // not a rolling 6-month / current-month window (which showed "July only").
      // Users can still narrow via the range picker or the D/W/M/Y presets.
      var today = new Date();
      var yr = today.getFullYear();
      var from = new Date(yr, 0, 1);   // 1 Jan this year
      var to = new Date(yr, 11, 31);   // 31 Dec this year
      this._m = new JSONModel({
        fromDate: from, toDate: to, preset: "", country: "UK", cur: "£",
        busy: false, hasData: true, error: "", curLabel: "£", rangeText: "",
        awaitingTotal: 0, awaitingPills: "",
        approvedTotal: 0, approvedPills: "", rejectedTotal: 0, rejectedPills: "",
        claimantsHtml: "", catHtml: "", donutHtml: "", trendHtml: "", trendFootHtml: "",
        geo: [], geoLegendHtml: "", geoSvgHtml: ""
      });
      this.getView().setModel(this._m, "dash");
      this._loaded = false;
      this._load(); // Dashboard is the landing tab — fetch on startup.
    },

    // Called by App.controller.onNavSelect when the tab is shown (and on filter changes).
    onRefresh: function () { this._load(); },

    _load: function () {
      var m = this._m, that = this;
      // Resolve against the OData model's service URL (not a literal "approval/")
      // so the fetch hits the correct app mount under the Work Zone approuter.
      var url = this._serviceUrl() + "dashboardStats(fromDate=" + ymd(m.getProperty("/fromDate")) +
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
      // Country drives the currency: UK → £, India → ₹ (single-currency dashboard).
      var cur = country === "IN" ? "₹" : "£";
      m.setProperty("/cur", cur);
      m.setProperty("/curLabel", cur);
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

      var pick = function (row) { return cur === "₹" ? (Number(row.inr) || 0) : (Number(row.gbp) || 0); };

      // Top 5 claimants — total claimed amount per person, in the active currency.
      var claimants = (j.topClaimants || [])
        .map(function (c) { return { name: c.name, value: pick(c) }; })
        .filter(function (r) { return r.value > 0; });
      m.setProperty("/claimantsHtml", claimantsChart(claimants, cur));

      var cat = (j.spendByCategory || []).map(function (c) {
        return { title: c.description || c.code, value: pick(c) };
      }).filter(function (r) { return r.value > 0; });
      m.setProperty("/catHtml", hBars(cat, cur));

      // Top Expense Items donut — APPROVED spend by category (same data as the bars,
      // approved claims only), in the active currency; centre shows the total Amount.
      m.setProperty("/donutHtml", donutChart(cat, cur, this.getText ? this.getText("dashAmount") : "Amount"));

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
      m.setProperty("/geoLegendHtml", geoFooter(geoRows));   // relevant per-country footer summary

      // Build a COMPLETE month-wise series spanning the selected range so the
      // Trend chart shows every month across the year (all 12 for the default
      // full-year window) — months without records render as empty columns
      // rather than collapsing the axis to whatever few months have data.
      var byMonth = {};
      (j.trend || []).forEach(function (t) { if (t && t.month) { byMonth[t.month] = t; } });
      var tr = [];
      var f = m.getProperty("/fromDate"), tEnd = m.getProperty("/toDate");
      if (f && tEnd && !isNaN(f) && !isNaN(tEnd)) {
        var cur = new Date(f.getFullYear(), f.getMonth(), 1);
        var last = new Date(tEnd.getFullYear(), tEnd.getMonth(), 1);
        for (var guard = 0; cur <= last && guard < 120; guard++) {
          var mm = cur.getMonth() + 1;
          var key = cur.getFullYear() + "-" + (mm < 10 ? "0" : "") + mm;
          var rec = byMonth[key] || {};
          tr.push({ label: MON[cur.getMonth()], submitted: rec.submitted || 0, approved: rec.approved || 0, rejected: rec.rejected || 0 });
          cur.setMonth(cur.getMonth() + 1);
        }
      } else {
        tr = (j.trend || []).map(function (t) {
          var parts = (t.month || "").split("-");
          var lbl = parts.length === 2 ? MON[(+parts[1]) - 1] : t.month;
          return { label: lbl, submitted: t.submitted || 0, approved: t.approved || 0, rejected: t.rejected || 0 };
        });
      }
      m.setProperty("/trendHtml", trendChart(tr));

      // Trend footer — count summary over the selected range (mirrors the geo footer).
      var tSub = tr.reduce(function (s, t) { return s + t.submitted; }, 0);
      var tApp = tr.reduce(function (s, t) { return s + t.approved; }, 0);
      var tRet = tr.reduce(function (s, t) { return s + t.rejected; }, 0);
      m.setProperty("/trendFootHtml",
        "<div class='bsxCardFoot bsxGeoFoot'><span>" +
          "<b>" + tSub + "</b> submitted · <b>" + tApp + "</b> approved · <b>" + tRet + "</b> returned" +
        "</span></div>");

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
            // Single bold-blue headline "amount · N claims" (matches the card design).
            new MText({ text: "{dashPop>/headline}" }).addStyleClass("bsxPopSpend sapUiTinyMargin")
          ] }) ]
        });
        this._geoPop.setModel(this._geoPopModel, "dashPop");
        this.getView().addDependent(this._geoPop);
      }
      var claimsLbl = this.getText ? this.getText("dashGeoClaims") : "claims";
      this._geoPopModel.setData({
        name: d.name || d.code,
        headline: (d.spendText || "") + " · " + (d.claims || 0) + " " + claimsLbl
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
