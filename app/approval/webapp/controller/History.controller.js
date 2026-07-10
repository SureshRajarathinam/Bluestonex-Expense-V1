sap.ui.define([
  "com/bluestonex/expense/approval/controller/BaseController",
  "com/bluestonex/expense/approval/model/formatter",
  "sap/ui/core/Fragment",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator"
], function (BaseController, formatter, Fragment, JSONModel, Filter, FilterOperator) {
  "use strict";

  var SVC = "/approval";
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c];
    });
  }

  // Human-friendly label + dot colour class for each audit action on the timeline.
  var EVENT_LABEL = {
    Submitted: "Submitted", Resubmitted: "Resubmitted for approval",
    FirstApproved: "1st-level approved", Approved: "Approved",
    Returned: "Returned for rework", Rejected: "Rejected",
    PolicyChanged: "Policy changed", WorkflowChanged: "Workflow changed"
  };
  function eventTone(a) {
    if (a === "Approved" || a === "FirstApproved") { return "ok"; }
    if (a === "Returned" || a === "Rejected") { return "no"; }
    return "sub";
  }
  function fmtDT(s) {
    if (!s) { return ""; }
    var d = new Date(s);
    if (isNaN(d)) { return String(s); }
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getDate()) + " " + MON[d.getMonth()] + " " + d.getFullYear() + " · " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  // Vertical timeline built from the ordered audit events (zero new library —
  // matches the Dashboard's hand-built charts).
  function timelineHtml(events) {
    if (!events || !events.length) { return "<div class='bsxTlEmpty'>No recorded activity yet.</div>"; }
    var rows = events.map(function (e) {
      var tone = eventTone(e.action);
      return "<div class='bsxTlItem'>" +
        "<span class='bsxTlDot bsxTlDot--" + tone + "'></span>" +
        "<div class='bsxTlBody'>" +
          "<div class='bsxTlHead'>" + esc(EVENT_LABEL[e.action] || e.action) +
            " <span class='bsxTlAt'>" + esc(fmtDT(e.at)) + "</span></div>" +
          "<div class='bsxTlSub'>" + esc(e.by || "") + (e.note ? " · " + esc(e.note) : "") + "</div>" +
        "</div>" +
      "</div>";
    }).join("");
    return "<div class='bsxTimeline'>" + rows + "</div>";
  }

  // Assigned approval chain + who actually decided (reuses .bsxChainNode).
  function chainHtml(j) {
    var node = function (lvl, assigned, decidedBy) {
      var done = !!decidedBy;
      return "<div class='bsxTlChainRow'>" +
        "<span class='bsxChainNode'>" + lvl + "</span>" +
        "<div class='bsxTlChainBody'>" +
          "<div class='bsxTlChainName'>" + esc(assigned || "—") + "</div>" +
          "<div class='bsxTlSub'>" + (done ? "Approved by " + esc(decidedBy) : "Awaiting decision") + "</div>" +
        "</div>" +
      "</div>";
    };
    var out = node(1, j.assignedL1, j.approvedL1By);
    if (j.country === "UK") { out += node(2, j.assignedL2, j.approvedL2By); }
    if (j.returnedBy) {
      out += "<div class='bsxTlChainRow'>" +
        "<span class='bsxChainNode bsxChainNode--no'>↩</span>" +
        "<div class='bsxTlChainBody'><div class='bsxTlChainName'>Returned for rework</div>" +
        "<div class='bsxTlSub'>by " + esc(j.returnedBy) + "</div></div></div>";
    }
    return "<div class='bsxTlChain'>" + out + "</div>";
  }

  return BaseController.extend("com.bluestonex.expense.approval.controller.History", {

    formatter: formatter,

    onInit: function () {
      this.getView().setModel(new JSONModel({ count: 0, approved: 0, rejected: 0 }), "view");
      this.getView().setModel(new JSONModel({}), "journey");
    },

    onUpdateFinished: function (oEvent) {
      var oView = this.getView().getModel("view");
      oView.setProperty("/count", oEvent.getParameter("total") || 0);
      var aCtx = this.byId("historyTable").getBinding("items").getCurrentContexts();
      var nA = 0, nR = 0;
      aCtx.forEach(function (c) {
        var s = c.getProperty("status");
        if (s === "Approved") { nA++; }
        // "Declined" = returned-for-rework (current) + legacy Rejected.
        if (s === "Returned" || s === "Rejected") { nR++; }
      });
      oView.setProperty("/approved", nA);
      oView.setProperty("/rejected", nR);
    },

    onRefresh: function () {
      this.byId("historyTable").getBinding("items").refresh();
    },

    _ymd: function (oDate) {
      if (!oDate) { return null; }
      var p = function (n) { return (n < 10 ? "0" : "") + n; };
      return oDate.getFullYear() + "-" + p(oDate.getMonth() + 1) + "-" + p(oDate.getDate());
    },

    _filterState: function () {
      return {
        status: this.byId("fStatus").getSelectedKey(),
        country: this.byId("fCountry").getSelectedKey(),
        claimNo: (this.byId("fSearch").getValue() || "").trim(),
        from: this._ymd(this.byId("fPeriod").getDateValue()),
        to: this._ymd(this.byId("fPeriod").getSecondDateValue())
      };
    },

    // Free multi-field search: the box matches across claim number, employee name,
    // employee ID and status; the Status/Country/Period selects narrow it (AND).
    // Fires on Enter / search-icon (SearchField) and on any dropdown/date change —
    // there is no Go button.
    onSearch: function () {
      var s = this._filterState();
      var aFilters = [];
      if (s.status) { aFilters.push(new Filter("status", FilterOperator.EQ, s.status)); }
      if (s.country) { aFilters.push(new Filter("country", FilterOperator.EQ, s.country)); }
      if (s.from && s.to) { aFilters.push(new Filter("claimPeriod", FilterOperator.BT, s.from, s.to)); }
      if (s.claimNo) {
        aFilters.push(new Filter({
          filters: [
            new Filter("claimNumber", FilterOperator.Contains, s.claimNo),
            new Filter("employeeName", FilterOperator.Contains, s.claimNo),
            new Filter("employeeNumber", FilterOperator.Contains, s.claimNo),
            new Filter("status", FilterOperator.Contains, s.claimNo)
          ],
          and: false
        }));
      }
      this.byId("historyTable").getBinding("items").filter(aFilters);
    },

    onExportPdf: function () {
      this.exportPdf("history", this._filterState());
    },

    // ── Row press → lazy-load the claim journey and open the detail dialog ─────
    onOpenClaim: function (oEvent) {
      var oCtx = oEvent.getParameter("listItem") ? oEvent.getParameter("listItem").getBindingContext() : oEvent.getSource().getBindingContext();
      var sNo = oCtx && oCtx.getProperty("claimNumber");
      if (!sNo) { return; }
      var that = this;

      var pDialog = this._pHistDialog || (this._pHistDialog = Fragment.load({
        id: this.getView().getId(),
        name: "com.bluestonex.expense.approval.view.HistoryDetail",
        controller: this
      }).then(function (oDialog) {
        that.getView().addDependent(oDialog);
        return oDialog;
      }));

      var sUrl = SVC + "/claimJourney(claimNumber='" + String(sNo).replace(/'/g, "''") + "')";
      var pJourney = fetch(encodeURI(sUrl), { headers: { Accept: "application/json" }, credentials: "same-origin" })
        .then(function (r) { if (!r.ok) { throw new Error("HTTP " + r.status); } return r.json(); });

      Promise.all([pDialog, pJourney]).then(function (aRes) {
        var oDialog = aRes[0];
        var j = aRes[1] || {};
        if (j.value && typeof j.value === "object") { j = j.value; } // tolerate {value:{…}}
        j.timelineHtml = timelineHtml(j.events);
        j.chainHtml = chainHtml(j);
        j.attachmentCount = (j.attachments || []).length;
        that.getView().getModel("journey").setData(j);
        oDialog.open();
      }).catch(function (e) { that.showError(e); });
    },

    onCloseHistDetail: function () {
      var oDialog = this.byId("histDialog");
      if (oDialog) { oDialog.close(); }
    },

    // Open an attachment's receipt in a new tab (uses the same media route as the
    // review dialog's receiptHref).
    onOpenAttachment: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext("journey");
      var sId = oCtx && oCtx.getProperty("itemID");
      if (sId) { window.open(this.formatter.receiptHref(sId), "_blank"); }
    }
  });
});
