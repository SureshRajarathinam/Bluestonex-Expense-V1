sap.ui.define([
  "com/bluestonex/expense/myexpenses/controller/BaseController",
  "com/bluestonex/expense/myexpenses/model/formatter",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/MessageBox",
  "sap/m/MessageToast"
], function (BaseController, formatter, JSONModel, Filter, FilterOperator, MessageBox, MessageToast) {
  "use strict";

  return BaseController.extend("com.bluestonex.expense.myexpenses.controller.Claims", {

    formatter: formatter,

    onInit: function () {
      this.getView().setModel(new JSONModel({ count: 0, submitted: 0, approved: 0 }), "view");
      this.getRouter().getRoute("list").attachPatternMatched(this._onListMatched, this);
    },

    onUpdateFinished: function (oEvent) {
      var oView = this.getView().getModel("view");
      oView.setProperty("/count", oEvent.getParameter("total") || 0);
      var aCtx = this.byId("claimsTable").getBinding("items").getCurrentContexts();
      var nSub = 0, nApp = 0;
      aCtx.forEach(function (c) {
        var s = c.getProperty("status");
        if (s === "Submitted" || s === "FirstApproved") { nSub++; }
        if (s === "Approved") { nApp++; }
      });
      oView.setProperty("/submitted", nSub);
      oView.setProperty("/approved", nApp);
    },

    _onListMatched: function () {
      var oBinding = this.byId("claimsTable").getBinding("items");
      if (oBinding) {
        oBinding.refresh();
      }
    },

    /** Extract the key predicate (inside the parentheses) from an OData V4 path. */
    _predicateOf: function (sPath) {
      var m = /\(([^)]*)\)/.exec(sPath);
      return m ? m[1] : "";
    },

    onRefresh: function () {
      var that = this;
      var oBinding = this.byId("claimsTable").getBinding("items");
      if (!oBinding) { return; }
      // A stray transient/pending change (e.g. an abandoned create context) makes
      // ODataListBinding.refresh() throw synchronously — which looked like "Refresh
      // does nothing". Clear pending changes first, then refresh with a visible
      // busy state + toast so the action is never silent.
      var oModel = this.getModel();
      if (oModel && oModel.hasPendingChanges && oModel.hasPendingChanges()) {
        try { oModel.resetChanges(); } catch (e) { /* best-effort */ }
      }
      this.byId("claimsPage").setBusy(true);
      oBinding.requestRefresh().then(function () {
        that.byId("claimsPage").setBusy(false);
        MessageToast.show(that.getText("msgRefreshed"));
      }).catch(function (e) {
        that.byId("claimsPage").setBusy(false);
        that.showError(e);
      });
    },

    _ymd: function (oDate) {
      if (!oDate) { return null; }
      var p = function (n) { return (n < 10 ? "0" : "") + n; };
      return oDate.getFullYear() + "-" + p(oDate.getMonth() + 1) + "-" + p(oDate.getDate());
    },

    /**
     * Live look-up: one free-text box searches across several fields (claim
     * number, employee name/number) combined with the Status / Period filters.
     * Runs on every keystroke / dropdown change (no "Go" button).
     */
    onSearch: function () {
      var aFilters = [];
      var sStatus = this.byId("fStatus").getSelectedKey();
      var sQuery = (this.byId("fSearch").getValue() || "").trim();
      var oPeriod = this.byId("fPeriod");
      var dFrom = oPeriod.getDateValue(), dTo = oPeriod.getSecondDateValue();

      if (sStatus) { aFilters.push(new Filter("status", FilterOperator.EQ, sStatus)); }
      if (dFrom && dTo) { aFilters.push(new Filter("claimPeriod", FilterOperator.BT, this._ymd(dFrom), this._ymd(dTo))); }
      if (sQuery) {
        // OR across the searchable text fields — a single box matches any of them.
        aFilters.push(new Filter({
          filters: [
            new Filter("claimNumber", FilterOperator.Contains, sQuery),
            new Filter("employeeName", FilterOperator.Contains, sQuery),
            new Filter("employeeNumber", FilterOperator.Contains, sQuery)
          ],
          and: false
        }));
      }

      this.byId("claimsTable").getBinding("items").filter(aFilters);
    },

    onOpenClaim: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext();
      this.navTo("detail", { key: encodeURIComponent(this._predicateOf(oCtx.getPath())) });
    },

    /**
     * Delete a claim the employee no longer needs. Only offered on Draft /
     * Returned / Rejected rows (see the view's visible binding); the backend
     * @restrict still scopes DELETE to the claim's own creator. Confirms first.
     */
    onDeleteClaim: function (oEvent) {
      var that = this;
      var oCtx = oEvent.getSource().getBindingContext();
      if (!oCtx) { return; }
      var sNo = oCtx.getProperty("claimNumber") || this.getText("deleteThisDraft");
      MessageBox.warning(this.getText("confirmDeleteClaim", [sNo]), {
        title: this.getText("confirmDeleteTitle"),
        actions: [MessageBox.Action.DELETE, MessageBox.Action.CANCEL],
        emphasizedAction: MessageBox.Action.DELETE,
        onClose: function (sAction) {
          if (sAction !== MessageBox.Action.DELETE) { return; }
          that.getView().setBusy(true);
          oCtx.delete().then(function () {
            that.getView().setBusy(false);
            MessageToast.show(that.getText("msgClaimDeleted"));
          }).catch(function (e) { that.getView().setBusy(false); that.showError(e); });
        }
      });
    },

    // ---- Create flow --------------------------------------------------------
    // Country is derived automatically from the logged-in user's site code
    // (EXP_EMPLOYEES.BaseSiteKey via whoami): UK* → UK, IN* → IN. Reimbursement is
    // only available for UK and India sites, so a site matching neither (e.g.
    // PLMK, PLRMT, Apphaus) — or an unresolvable site — gets an informational
    // popup and NO claim is created.
    onCreate: function () {
      var that = this;
      this._resolveSite().then(function (sSite) {
        var sCountry = that._countryFromSite(sSite);
        if (sCountry) {
          that._createClaim(sCountry);
        } else {
          that._showSiteNotSupported();
        }
      });
    },

    // Non-UK/IN (or unresolved) site: reimbursement isn't available for this
    // employee's site — tell them, and do not create a claim.
    _showSiteNotSupported: function () {
      MessageBox.information(this.getText("msgSiteNotSupported"), {
        title: this.getText("titleSiteNotSupported")
      });
    },

    // Prefix-map a site code to a claim country. Case-insensitive and
    // prefix-based (UKOSW → UK, inaug → IN); returns "" for sites that match
    // neither so the caller falls back to the country picker.
    _countryFromSite: function (sSite) {
      var s = (sSite || "").trim().toUpperCase();
      if (s.indexOf("UK") === 0) { return "UK"; }
      if (s.indexOf("IN") === 0) { return "IN"; }
      return "";
    },

    // Fetch the logged-in user's site code (BaseSiteKey) via whoami(), cached.
    // Resolved against the service URL so it works under the Work Zone managed
    // approuter (never a literal relative path). Never rejects — resolves to ""
    // on any failure so Create still works (falls back to the country popup).
    _resolveSite: function () {
      if (this._pSite) { return this._pSite; }
      this._pSite = fetch(this._serviceUrl() + "whoami()", { headers: { Accept: "application/json" }, credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return (j && j.site) || ""; })
        .catch(function () { return ""; });
      return this._pSite;
    },

    // Create a draft claim for the given country and open it (used by the auto
    // site-code path in onCreate).
    _createClaim: function (sCountry) {
      var that = this;
      var sToday = new Date().toISOString().slice(0, 10);
      var oList = this.byId("claimsTable").getBinding("items");

      // create(initialData, bSkipRefresh) — skip refresh since we navigate away.
      // Send currency alongside country (IN → INR, UK → GBP) so the claim detail
      // shows the right symbol immediately, without waiting for a server round-trip.
      var oCtx = oList.create({ country: sCountry, currency: sCountry === "IN" ? "INR" : "GBP", claimPeriod: sToday }, true);
      this.getView().setBusy(true);

      oCtx.created().then(function () {
        that.getView().setBusy(false);
        that.navTo("detail", { key: encodeURIComponent(that._predicateOf(oCtx.getPath())) });
      }).catch(function (oErr) {
        that.getView().setBusy(false);
        that.showError(oErr);
      });
    }
  });
});
