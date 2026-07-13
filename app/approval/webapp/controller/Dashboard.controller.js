sap.ui.define([
  "com/bluestonex/expense/approval/controller/BaseController",
  "com/bluestonex/expense/approval/model/formatter",
  "sap/ui/model/json/JSONModel",
  "sap/ui/core/IconPool"
], function (BaseController, formatter, JSONModel, IconPool) {
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

  // "Nice" upper bound for a value axis (1/2/5 × 10ⁿ, ≥ x). Used for the wave Y ticks.
  function niceNum(x) {
    if (!(x > 0)) { return 1; }
    var exp = Math.floor(Math.log(x) / Math.LN10);
    var f = x / Math.pow(10, exp);
    var nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, exp);
  }

  // ── Approved-spend wave (replaces the Geo card) ─────────────────────────────
  // Smooth SVG area + line of monthly APPROVED gross total. X = months (year stamp
  // at boundaries, matching the trend); Y = amount in the active currency. Circle
  // markers per month, dotted gridlines, 5 currency-formatted Y ticks. Scrolls
  // horizontally when the range spans many months.
  function waveChart(rows, cur) {
    if (!rows.length) { return "<div class='bsxTlEmpty bsxCardPad'>No approved spend for the selected filters.</div>"; }
    var n = rows.length;
    var maxV = rows.reduce(function (mx, r) { return Math.max(mx, Number(r.value) || 0); }, 0);
    var nm = niceNum(maxV || 1);
    var PL = 54, PR = 16, PT = 16, PB = 34, H = 220, step = 76;
    var innerW = Math.max(step, (n - 1) * step);
    var W = PL + PR + innerW, plotB = H - PB, plotT = PT, plotH = plotB - plotT;
    var xAt = function (i) { return n === 1 ? PL + innerW / 2 : PL + (i / (n - 1)) * innerW; };
    var yAt = function (v) { return plotB - (Math.max(0, Number(v) || 0) / nm) * plotH; };
    var pts = rows.map(function (r, i) { return { x: xAt(i), y: yAt(r.value) }; });
    // Smooth line: Catmull-Rom → cubic bezier control points.
    var d = "M" + pts[0].x.toFixed(1) + " " + pts[0].y.toFixed(1);
    for (var k = 0; k < n - 1; k++) {
      var p0 = pts[k - 1] || pts[k], p1 = pts[k], p2 = pts[k + 1], p3 = pts[k + 2] || p2;
      var c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      var c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += " C" + c1x.toFixed(1) + " " + c1y.toFixed(1) + " " + c2x.toFixed(1) + " " + c2y.toFixed(1) + " " + p2.x.toFixed(1) + " " + p2.y.toFixed(1);
    }
    var area = d + " L" + pts[n - 1].x.toFixed(1) + " " + plotB + " L" + pts[0].x.toFixed(1) + " " + plotB + " Z";
    var grid = "", ylab = "";
    for (var t = 0; t <= 4; t++) {
      var gy = plotB - (t / 4) * plotH;
      grid += "<line x1='" + PL + "' y1='" + gy.toFixed(1) + "' x2='" + (W - PR) + "' y2='" + gy.toFixed(1) + "' class='bsxWaveGridH'/>";
      ylab += "<text x='" + (PL - 8) + "' y='" + (gy + 3).toFixed(1) + "' class='bsxWaveYlab'>" + esc(money(cur, nm * t / 4)) + "</text>";
    }
    var vgrid = "", marks = "", xlab = "";
    pts.forEach(function (p, i) {
      vgrid += "<line x1='" + p.x.toFixed(1) + "' y1='" + plotT + "' x2='" + p.x.toFixed(1) + "' y2='" + plotB + "' class='bsxWaveGridV'/>";
      marks += "<circle cx='" + p.x.toFixed(1) + "' cy='" + p.y.toFixed(1) + "' r='4.5' class='bsxWaveDot'><title>" +
        esc(rows[i].label) + (rows[i].year ? " " + rows[i].year : "") + " · " + esc(money(cur, rows[i].value)) + "</title></circle>";
      xlab += "<text x='" + p.x.toFixed(1) + "' y='" + (plotB + 16) + "' class='bsxWaveXlab'>" + esc(rows[i].label) +
        (rows[i].year ? "<tspan x='" + p.x.toFixed(1) + "' dy='11' class='bsxWaveXyear'>" + esc(rows[i].year) + "</tspan>" : "") + "</text>";
    });
    return "<div class='bsxWaveScroll'><svg class='bsxWave' width='" + W + "' height='" + H + "' viewBox='0 0 " + W + " " + H + "'>" +
      "<defs><linearGradient id='bsxWaveGrad' x1='0' y1='0' x2='0' y2='1'>" +
        "<stop offset='0%' class='bsxWaveG0'/><stop offset='100%' class='bsxWaveG1'/></linearGradient></defs>" +
      grid + vgrid +
      "<path d='" + area + "' class='bsxWaveArea'/>" +
      "<path d='" + d + "' class='bsxWaveLine'/>" +
      marks + ylab + xlab +
    "</svg></div>";
  }

  // ── Donut category icons ────────────────────────────────────────────────────
  // Expense-type code → sap-icon name, resolved to a font glyph via IconPool so it
  // can be rendered inside the raw-HTML donut. Falls back to a receipt glyph.
  var CAT_ICON = {
    TRAIN: "train", PHONE: "iphone", PARKING: "car", FOOD: "meal", HOTEL: "bed",
    TAXI: "car", FLIGHT: "flight", TOLLS: "road", CAR_HIRE: "car-rental", OTHER: "receipt"
  };
  function iconGlyph(code) {
    var info = IconPool.getIconInfo(CAT_ICON[code] || "receipt") || IconPool.getIconInfo("receipt");
    return info ? { ch: info.content, ff: info.fontFamily } : { ch: "", ff: "" };
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
      var tot = (r.submitted || 0) + (r.approved || 0) + (r.rejected || 0);
      var tip = "Submitted " + (r.submitted || 0) + " · Approved " + (r.approved || 0) +
                " · Returned " + (r.rejected || 0) + " · Total " + tot;
      return "<div class='bsxVGroup' title='" + tip + "'>" +
        "<div class='bsxVBars'>" +
          "<div class='bsxVCol'><div class='bsxVBar bsxVBar--sub' style='height:" + pct(r.submitted, max) + "%'></div></div>" +
          "<div class='bsxVCol'><div class='bsxVBar bsxVBar--ok' style='height:" + pct(r.approved, max) + "%'></div></div>" +
          "<div class='bsxVCol'><div class='bsxVBar bsxVBar--no' style='height:" + pct(r.rejected, max) + "%'></div></div>" +
        "</div>" +
        "<div class='bsxVLabel'>" + esc(r.label) +
          (r.year ? "<span class='bsxVYear'>" + esc(r.year) + "</span>" : "") +
        "</div>" +
      "</div>";
    }).join("");
    return "<div class='bsxChart'>" + legend + "<div class='bsxVChart bsxVChart--trend'>" + bars + "</div></div>";
  }

  // Total reimbursed spend donut: a graduated-blue ring (darkest = largest share),
  // small inter-segment gaps, a per-category icon badge on each segment's mid-angle,
  // and a big center label = the TOP category's share % + its name. Currency-native
  // (approved spend by category). Rows: [{code, title, value}].
  function donutChart(rows, cur) {
    var data = rows.filter(function (r) { return r.value > 0; })
      .sort(function (a, b) { return b.value - a.value; });
    if (!data.length) { return "<div class='bsxTlEmpty bsxCardPad'>No expense items for the selected filters.</div>"; }
    var total = data.reduce(function (s, r) { return s + r.value; }, 0);
    var top = data[0], topPct = total ? Math.round((top.value / total) * 100) : 0;
    var R = 76, C = 2 * Math.PI * R, GAP = data.length > 1 ? 2.4 : 0, acc = 0;
    var arcs = "", badges = "", legend = "";
    data.forEach(function (r, i) {
      var seg = (r.value / total) * C;
      var col = blueShade(i, data.length);
      var dashLen = Math.max(0.5, seg - GAP);
      arcs += "<circle cx='100' cy='100' r='" + R + "' fill='none' stroke='" + col +
        "' stroke-width='22' stroke-dasharray='" + dashLen.toFixed(2) + " " + (C - dashLen).toFixed(2) +
        "' stroke-dashoffset='" + (-acc).toFixed(2) + "'></circle>";
      // Icon badge at the segment's mid-angle (clockwise from top, screen coords).
      var th = 2 * Math.PI * ((acc + seg / 2) / C);
      var x = 100 + R * Math.sin(th), y = 100 - R * Math.cos(th);
      var g = iconGlyph(r.code);
      badges += "<div class='bsxDonutIcon' style='left:" + (x / 2).toFixed(1) + "%;top:" + (y / 2).toFixed(1) + "%'>" +
        "<span style=\"font-family:'" + g.ff + "'\">" + g.ch + "</span></div>";
      legend += "<span class='bsxDonutLeg'><i class='bsxDonutDot' style='background:" + col + "'></i>" + esc(r.title) + "</span>";
      acc += seg;
    });
    return "<div class='bsxDonut'>" +
      "<div class='bsxDonutRingWrap'>" +
        "<svg class='bsxDonutSvg' viewBox='0 0 200 200'><g transform='rotate(-90 100 100)'>" + arcs + "</g></svg>" +
        "<div class='bsxDonutHole'>" +
          "<div class='bsxDonutNum'>" + topPct + "%</div>" +
          "<div class='bsxDonutLbl'>" + esc(top.title) + "</div>" +
        "</div>" +
        badges +
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
        claimantsHtml: "", catHtml: "", donutHtml: "", waveHtml: "", trendHtml: "", trendFootHtml: ""
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
        return { code: c.code, title: c.description || c.code, value: pick(c) };
      }).filter(function (r) { return r.value > 0; });
      m.setProperty("/catHtml", hBars(cat, cur));

      // Total reimbursed spend donut — APPROVED spend by category in the active
      // currency: graduated-blue ring, ring icons, center = top category % + name.
      m.setProperty("/donutHtml", donutChart(cat, cur));

      // Build a COMPLETE month-wise series spanning the selected range so the
      // Trend chart shows every month across the year (all 12 for the default
      // full-year window) — months without records render as empty columns
      // rather than collapsing the axis to whatever few months have data.
      var byMonth = {};
      (j.trend || []).forEach(function (t) { if (t && t.month) { byMonth[t.month] = t; } });
      var tr = [];
      // `value` = approved GROSS total for the month in the active currency (feeds
      // the wave card); counts feed the trend bars. (dCur is a Date — kept distinct
      // from the currency `cur` above.)
      var amt = function (rec) { return cur === "₹" ? (Number(rec.inr) || 0) : (Number(rec.gbp) || 0); };
      var f = m.getProperty("/fromDate"), tEnd = m.getProperty("/toDate");
      if (f && tEnd && !isNaN(f) && !isNaN(tEnd)) {
        var dCur = new Date(f.getFullYear(), f.getMonth(), 1);
        var dLast = new Date(tEnd.getFullYear(), tEnd.getMonth(), 1);
        var prevYear = null;
        for (var guard = 0; dCur <= dLast && guard < 120; guard++) {
          var mm = dCur.getMonth() + 1;
          var yr = dCur.getFullYear();
          var key = yr + "-" + (mm < 10 ? "0" : "") + mm;
          var rec = byMonth[key] || {};
          // Stamp the year under the month only at range start and each year change,
          // so a multi-year span (e.g. Jul 2025 → Jul 2026) is recognisable without
          // repeating the year on every column.
          tr.push({ label: MON[dCur.getMonth()], year: (yr !== prevYear ? String(yr) : ""), submitted: rec.submitted || 0, approved: rec.approved || 0, rejected: rec.rejected || 0, value: amt(rec) });
          prevYear = yr;
          dCur.setMonth(dCur.getMonth() + 1);
        }
      } else {
        tr = (j.trend || []).map(function (t) {
          var parts = (t.month || "").split("-");
          var lbl = parts.length === 2 ? MON[(+parts[1]) - 1] : t.month;
          return { label: lbl, year: parts.length === 2 ? parts[0] : "", submitted: t.submitted || 0, approved: t.approved || 0, rejected: t.rejected || 0, value: amt(t) };
        });
      }
      m.setProperty("/trendHtml", trendChart(tr));

      // Approved-spend wave — same month series, plotting the approved amount.
      m.setProperty("/waveHtml", waveChart(tr.map(function (t) {
        return { label: t.label, year: t.year, value: t.value || 0 };
      }), cur));

      // Trend footer — count summary over the selected range (mirrors the geo footer).
      var tSub = tr.reduce(function (s, t) { return s + t.submitted; }, 0);
      var tApp = tr.reduce(function (s, t) { return s + t.approved; }, 0);
      var tRet = tr.reduce(function (s, t) { return s + t.rejected; }, 0);
      m.setProperty("/trendFootHtml",
        "<div class='bsxCardFoot bsxTrendFoot'><span>" +
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
