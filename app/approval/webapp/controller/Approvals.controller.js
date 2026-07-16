sap.ui.define([
  "com/bluestonex/expense/approval/controller/BaseController",
  "com/bluestonex/expense/approval/model/formatter",
  "sap/ui/core/Fragment",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/MessageToast"
], function (BaseController, formatter, Fragment, JSONModel, Filter, FilterOperator, MessageToast) {
  "use strict";

  return BaseController.extend("com.bluestonex.expense.approval.controller.Approvals", {

    formatter: formatter,

    onInit: function () {
      this.getView().setModel(new JSONModel({ count: 0, pendUK: 0, pendIN: 0 }), "view");
      // Open directly on UK (no country landing); the corner Select switches country.
      this.getView().setModel(new JSONModel({
        choose: false, detail: true, country: "UK", isUK: true, isIN: false, title: this.getText("apvTitleUK")
      }), "ui");
      this._loadCounts();
    },

    // Pending-claim counts per country for the landing cards. Fetch only the
    // server-side $count (one light request per country, batched via the default
    // group) instead of pulling up to 999 rows just to measure their length —
    // a big open-time saving. Same country filter as before (the Approvals queue
    // is already scoped to pending statuses server-side).
    _loadCounts: function () {
      var oModel = this.getModel();
      var oView = this.getView().getModel("view");
      ["UK", "IN"].forEach(function (sCountry) {
        var oBinding = oModel.bindList("/Approvals", null, null,
          [new Filter("country", FilterOperator.EQ, sCountry)], { $count: true });
        oBinding.requestContexts(0, 1)
          .then(function () {
            oView.setProperty(sCountry === "UK" ? "/pendUK" : "/pendIN", oBinding.getCount() || 0);
          })
          .catch(function () { /* leave count at 0 */ });
      });
    },

    // Corner country switch — funnels through the existing _open (same data logic).
    onSwitchCountry: function (oEvent) { this._open(oEvent.getParameter("selectedItem").getKey()); },

    // Drill into the chosen country's pending claims (scope the table by country).
    _open: function (sCountry) {
      this.getView().getModel("ui").setData({
        choose: false, detail: true, country: sCountry,
        isUK: sCountry === "UK", isIN: sCountry === "IN",
        title: this.getText(sCountry === "UK" ? "apvTitleUK" : "apvTitleIN")
      });
      this.byId("fSearch").setValue("");
      this.onGo();
    },

    onUpdateFinished: function (oEvent) {
      this.getView().getModel("view").setProperty("/count", oEvent.getParameter("total") || 0);
      // Record the country now on screen + clear the busy overlay set in onGo once the
      // country-scoped rows have rendered.
      this._loadedCountry = this.getView().getModel("ui").getProperty("/country");
      this.byId("approvalsTable").setBusy(false);
    },

    onRefresh: function () {
      this.byId("approvalsTable").getBinding("items").refresh();
      this._loadCounts();
    },

    _ymd: function (oDate) {
      if (!oDate) { return null; }
      var p = function (n) { return (n < 10 ? "0" : "") + n; };
      return oDate.getFullYear() + "-" + p(oDate.getMonth() + 1) + "-" + p(oDate.getDate());
    },

    /** Free multi-field search (claim no · employee · emp ID · status) + Period,
     *  scoped to the chosen country. Fires on Enter / search-icon and on Period
     *  change — no Go button. */
    onGo: function () {
      var aFilters = [];
      var sCountry = this.getView().getModel("ui").getProperty("/country");
      var sQ = (this.byId("fSearch").getValue() || "").trim();
      var oPeriod = this.byId("fPeriod");
      var dFrom = oPeriod.getDateValue(), dTo = oPeriod.getSecondDateValue();

      if (sCountry) { aFilters.push(new Filter("country", FilterOperator.EQ, sCountry)); }
      if (dFrom && dTo) { aFilters.push(new Filter("claimPeriod", FilterOperator.BT, this._ymd(dFrom), this._ymd(dTo))); }
      if (sQ) {
        aFilters.push(new Filter({
          filters: [
            new Filter("claimNumber", FilterOperator.Contains, sQ),
            new Filter("employeeName", FilterOperator.Contains, sQ),
            new Filter("employeeNumber", FilterOperator.Contains, sQ),
            new Filter("status", FilterOperator.Contains, sQ)
          ],
          and: false
        }));
      }

      // The table binding starts `suspended` (Approvals.view.xml) so it never
      // auto-loads the unfiltered UK+IN set — that unfiltered load is what briefly
      // flashed India rows under the UK tab. On first entry we apply the country
      // filter and resume; on later calls the binding is live and .filter() requests
      // immediately.
      var oTable = this.byId("approvalsTable");
      var oBinding = oTable.getBinding("items");
      var bSuspended = oBinding.isSuspended();
      // Busy the table only when the country is (re)loading — first load, or a switch
      // to a different country — so the previous country's rows can't show while the
      // new request is in flight. A same-country search/period change updates in place
      // (nothing wrong-country to hide) and so can't leave the table stuck busy if the
      // filter happens to be a no-op (which fires no updateFinished).
      if (bSuspended || sCountry !== this._loadedCountry) { oTable.setBusy(true); }
      oBinding.filter(aFilters);
      if (bSuspended) { oBinding.resume(); }
    },

    onExportPdf: function () {
      this.exportPdf("approvals", {
        status: "",
        country: this.getView().getModel("ui").getProperty("/country"),
        claimNo: (this.byId("fSearch").getValue() || "").trim(),
        from: this._ymd(this.byId("fPeriod").getDateValue()),
        to: this._ymd(this.byId("fPeriod").getSecondDateValue())
      });
    },

    // Open on UK each time the tab is (re)entered; the corner Select switches country.
    onTabEnter: function () { this._open("UK"); },

    onReview: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext();
      var that = this;
      var pDialog = this._pReviewDialog || (this._pReviewDialog = Fragment.load({
        id: this.getView().getId(),
        name: "com.bluestonex.expense.approval.view.ReviewDialog",
        controller: this
      }).then(function (oDialog) {
        that.getView().addDependent(oDialog);
        return oDialog;
      }));

      pDialog.then(function (oDialog) {
        oDialog.setBindingContext(oCtx);
        // Per-item cells resolve labels/currency from a small JSON 'rev' model:
        //  • currency — item rows have none of their own, so money renders £/₹ right
        //  • types    — expenseType_code → employee-facing description ("Taxi / Cab")
        //  • taxLabels— vatType → "CODE (rate%)" e.g. "STD (18%)"
        // Set currency + empty maps now so the dialog opens immediately; the maps
        // populate async and the JSON bindings refresh the cells when they arrive.
        oDialog.setModel(new JSONModel({ currency: oCtx.getProperty("currency") || "GBP", types: {}, taxLabels: {} }), "rev");
        that._loadReviewLookups(oDialog, oCtx.getProperty("country") || "UK");
        that.byId("commentArea").setValue("");
        oDialog.open();
      });
    },

    // Build the Review dialog's label maps: expense-type descriptions (all rows) +
    // the country's tax-type "CODE (rate%)" labels. Both ExpenseTypes and TaxTypes
    // (with rate) are exposed read-only on ApprovalService. Mirrors the my-expenses
    // _loadTaxRate pct() logic so the % shown matches what the employee picked.
    _loadReviewLookups: function (oDialog, sCountry) {
      var oModel = this.getView().getModel();
      var oTypes = oModel.bindList("/ExpenseTypes");
      var oTax = oModel.bindList("/TaxTypes", null, null, [new Filter("country", FilterOperator.EQ, sCountry)]);
      Promise.all([oTypes.requestContexts(0, 200), oTax.requestContexts(0, 100)]).then(function (aRes) {
        var oRev = oDialog.getModel("rev");
        if (!oRev) { return; }
        var mTypes = {};
        aRes[0].forEach(function (c) { var o = c.getObject(); mTypes[o.code] = o.description; });
        var mTax = {};
        aRes[1].forEach(function (c) {
          var o = c.getObject();
          var pct = Math.round((Number(o.rate) || 0) * 10000) / 100; // 0.18 → 18
          mTax[o.code] = o.code + " (" + pct + "%)";
        });
        oRev.setProperty("/types", mTypes);
        oRev.setProperty("/taxLabels", mTax);
      }).catch(function () { /* labels fall back to the raw code via .formatter.lookupText */ });
    },

    onCloseReview: function () {
      this.byId("reviewDialog").close();
    },

    _decide: function (sAction, sMsgKey) {
      var oDialog = this.byId("reviewDialog");
      var oCtx = oDialog.getBindingContext();
      var sComment = this.byId("commentArea").getValue();

      if (sAction === "reject" && !sComment.trim()) {
        MessageToast.show(this.getText("rejectReasonRequired"));
        return;
      }

      // Capture the recipient signals BEFORE the action — the row leaves the queue
      // once decided. The email goes to: the L2 approver when a UK Submitted claim
      // is approved (escalation), otherwise the employee (final approve / return).
      var sCountry = oCtx.getProperty("country");
      var sStatus = oCtx.getProperty("status");
      var sEmployee = oCtx.getProperty("employeeName") || "";

      // Guard against a double-submit: the Approve/Reject buttons live in the
      // dialog (static area), which view.setBusy does NOT cover, so a fast
      // double-click could fire the action twice. Busy the DIALOG and gate on a
      // reentrancy flag (fix D3).
      if (this._deciding) { return; }
      this._deciding = true;

      var that = this;
      oDialog.setBusy(true);
      this.callAction(oCtx, "ApprovalService." + sAction, { comment: sComment })
        .then(function () {
          that._deciding = false;
          oDialog.setBusy(false);
          oDialog.close();
          // Resolve who the notification email went to, then toast their name.
          var pName = (sAction === "approve" && sCountry === "UK" && sStatus === "Submitted")
            ? that._approverName(sCountry, 2)          // escalated to the second-level approver
            : Promise.resolve(sEmployee);              // final approve / return → the employee
          return pName.then(function (sName) {
            MessageToast.show(sName ? that.getText("msgEmailSent", [sName]) : that.getText(sMsgKey));
            that.byId("approvalsTable").getBinding("items").refresh();
            that._loadCounts();
          });
        })
        .catch(function (e) {
          that._deciding = false;
          oDialog.setBusy(false);
          that.showError(e);
        });
    },

    // Full name of the country's approver at a given level (2 = second-level), for
    // the "email sent to X" toast. Uses _serviceUrl() so the fetch resolves under
    // the Work Zone approuter mount. Resolves to "" on any failure.
    _approverName: function (sCountry, iLevel) {
      if (!sCountry) { return Promise.resolve(""); }
      return fetch(this._serviceUrl() + "approverFor(country='" + encodeURIComponent(sCountry) + "',level=" + (iLevel || 1) + ")",
        { headers: { Accept: "application/json" }, credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return (j && j.value) || ""; })
        .catch(function () { return ""; });
    },

    onApprove: function () {
      this._decide("approve", "msgApproved");
    },

    onReject: function () {
      this._decide("reject", "msgRejected");
    }
  });
});
