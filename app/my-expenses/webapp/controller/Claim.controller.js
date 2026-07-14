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

  return BaseController.extend("com.bluestonex.expense.myexpenses.controller.Claim", {

    formatter: formatter,

    onInit: function () {
      this.getView().setModel(new JSONModel({ editable: false, canEdit: false, canSubmit: false, isReturned: false, returnReason: "", itemCount: 0, mileageCount: 0, stdRate: 0, mileageRate: 0, receiptThreshold: 25, currency: "GBP", taxTypes: [], emp: {}, live: { net: 0, tax: 0, total: 0 } }), "ui");
      // Which expense types always require a receipt (code → true). Loaded once so
      // the submit gate can mirror the server rule in srv/lib/validate.js (Rule 4).
      this._receiptTypes = {};
      this._loadReceiptTypes();
      // Identify the logged-in employee once and populate the header (name, number,
      // site, payroll area) — so a brand-new draft shows the employee immediately.
      this._loadEmployee();
      this.getRouter().getRoute("detail").attachPatternMatched(this._onMatched, this);
    },

    // Fetch the current user's employee master data (EXP_EMPLOYEES via whoami())
    // into the ui model. Resolved against the OData service URL so it works under
    // the Work Zone managed approuter (never a literal relative path).
    _loadEmployee: function () {
      var oUi = this.getView().getModel("ui");
      fetch(this._serviceUrl() + "whoami()", { headers: { Accept: "application/json" }, credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j) { return; }
          oUi.setProperty("/emp", {
            fullName: j.fullName || "",
            employeeNumber: j.employeeNumber || "",
            site: j.site || "",
            payrollArea: j.payrollArea || ""
          });
        })
        .catch(function () { /* header employee fields are best-effort — ignore */ });
    },

    // Cache the per-type "requiresReceipt" flags from the read-only ExpenseTypes
    // list so client validation matches the backend without a per-submit fetch.
    _loadReceiptTypes: function () {
      var that = this;
      var oList = this.getModel().bindList("/ExpenseTypes");
      oList.requestContexts(0, 100).then(function (aCtx) {
        aCtx.forEach(function (c) {
          var o = c.getObject();
          that._receiptTypes[o.code] = !!o.requiresReceipt;
        });
      }).catch(function () { /* non-fatal: server still enforces on submit */ });
    },

    onItemsUpdated: function (oEvent) {
      this.getView().getModel("ui").setProperty("/itemCount", oEvent.getParameter("total") || 0);
      this._recalcTotals();
    },

    onMileageUpdated: function (oEvent) {
      this.getView().getModel("ui").setProperty("/mileageCount", oEvent.getParameter("total") || 0);
      this._recalcTotals();
    },

    // Fired on every item/mileage line edit (gross, tax type, miles, rate) so the
    // corner Net/Tax/Total refresh in real time as the user types/commits.
    onLineChange: function () {
      this._recalcTotals();
    },

    // Recompute the header Net / Tax / Total into the ui model (/live) from the
    // current item + mileage rows. Mirrors srv/lib/calc.js claimTotals EXACTLY
    // (net incl. mileage, tax = items only, total incl. mileage) using the shared
    // formatter.split/num so rounding matches what before('SAVE') will persist.
    // While editing a draft it derives net/tax live from gross + tax type + the
    // country rate; for a saved (read-only) claim it uses the persisted amounts.
    _recalcTotals: function () {
      var oUi = this.getView().getModel("ui");
      var bEdit = !!oUi.getProperty("/editable");
      var nRate = oUi.getProperty("/stdRate") || 0;
      var itemsNet = 0, itemsVat = 0, itemsGross = 0, miles = 0;

      var oItems = this.byId("itemsTable").getBinding("items");
      (oItems ? oItems.getCurrentContexts() : []).forEach(function (c) {
        if (!c) { return; }
        var o = c.getObject();
        var g = formatter.num(o.grossAmount);
        var p = bEdit ? formatter.split(g, o.vatType, nRate)
                      : { net: formatter.num(o.netAmount), vat: formatter.num(o.vatAmount) };
        itemsNet += p.net; itemsVat += p.vat; itemsGross += g;
      });

      var oMile = this.byId("mileageTable").getBinding("items");
      (oMile ? oMile.getCurrentContexts() : []).forEach(function (c) {
        if (!c) { return; }
        var o = c.getObject();
        miles += bEdit ? (formatter.num(o.milesCount) * formatter.num(o.ratePerMile))
                       : formatter.num(o.totalAmount);
      });

      var r2 = function (n) { return parseFloat((Number(n) || 0).toFixed(2)); };
      oUi.setProperty("/live/net", r2(itemsNet + miles));
      oUi.setProperty("/live/tax", r2(itemsVat));
      oUi.setProperty("/live/total", r2(itemsGross + miles));
    },

    _predicateOf: function (sPath) {
      var m = /\(([^)]*)\)/.exec(sPath);
      return m ? m[1] : "";
    },

    _onMatched: function (oEvent) {
      var sPredicate = decodeURIComponent(oEvent.getParameter("arguments").key);
      this._bindClaim(sPredicate);
    },

    _bindClaim: function (sPredicate) {
      var bEditable = sPredicate.indexOf("IsActiveEntity=false") > -1;
      var oUi = this.getView().getModel("ui");
      oUi.setProperty("/editable", bEditable);
      oUi.setProperty("/canEdit", false);
      oUi.setProperty("/canSubmit", false);
      var that = this;
      this.getView().bindElement({
        path: "/MyClaims(" + sPredicate + ")",
        parameters: { $expand: "items,mileageClaims" },
        events: {
          dataReceived: function () {
            var oCtx = that.getView().getBindingContext();
            var sStatus = oCtx && oCtx.getProperty("status");
            // Reworkable = a fresh Draft OR a Returned claim the approver sent
            // back. Both can be edited & (re)submitted; the same record is reused.
            var bReworkable = !sStatus || sStatus === "Draft" || sStatus === "Returned";
            var bReturned = sStatus === "Returned";
            oUi.setProperty("/canSubmit", bReworkable);
            oUi.setProperty("/canEdit", !bEditable && bReworkable);
            oUi.setProperty("/isReturned", bReturned);
            oUi.setProperty("/returnReason", (bReturned && oCtx && oCtx.getProperty("rejectionReason")) || "");
            oUi.setProperty("/currency", (oCtx && oCtx.getProperty("currency")) || "GBP");
            that._loadTaxRate(oCtx && oCtx.getProperty("country"));
          }
        }
      });
    },

    _claimCtx: function () {
      return this.getView().getBindingContext();
    },

    // ---- Net / VAT live preview ---------------------------------------------
    // Loads the standard tax rate for the claim's country (UK -> vatRate,
    // India -> gstRate) so the items table can preview the net/VAT split as the
    // user types the gross. The server before('SAVE') remains authoritative.
    _loadTaxRate: function (sCountry) {
      var that = this;
      var oUi = this.getView().getModel("ui");
      if (!sCountry) { oUi.setProperty("/stdRate", 0); oUi.setProperty("/mileageRate", 0); oUi.setProperty("/taxTypes", []); return; }
      // Country-aware tax types (VAT for UK, GST for India) for the item dropdown.
      var oTax = this.getModel().bindList("/TaxTypes", null, null, [
        new Filter("country", FilterOperator.EQ, sCountry)
      ]);
      oTax.requestContexts(0, 100).then(function (aCtx) {
        oUi.setProperty("/taxTypes", aCtx.map(function (c) {
          var o = c.getObject();
          return { code: o.code, description: o.description };
        }));
      }).catch(function () { oUi.setProperty("/taxTypes", []); });
      var oList = this.getModel().bindList("/Policies", null, null, [
        new Filter("country", FilterOperator.EQ, sCountry)
      ]);
      oList.requestContexts(0, 1).then(function (aCtx) {
        var rate = 0, mileageRate = 0, threshold = 25;
        if (aCtx.length) {
          var p = aCtx[0].getObject();
          rate = Number(sCountry === "IN" ? p.gstRate : p.vatRate) || 0;
          // Live per-country mileage rate — the new-row default comes from here,
          // not a hardcoded literal (mirrors the server-authoritative policy).
          mileageRate = Number(p.mileageRate) || 0;
          // Receipt threshold drives the client-side "attach a receipt" gate.
          if (p.receiptThreshold != null) { threshold = Number(p.receiptThreshold) || 0; }
        }
        oUi.setProperty("/stdRate", rate);
        oUi.setProperty("/mileageRate", mileageRate);
        oUi.setProperty("/receiptThreshold", threshold);
        // Rate is now known — recompute so the corner totals are correct even if
        // the item/mileage tables rendered before the policy resolved.
        that._recalcTotals();
      }).catch(function () { oUi.setProperty("/stdRate", 0); oUi.setProperty("/mileageRate", 0); });
    },

    // ---- Inline rows --------------------------------------------------------
    onAddItem: function () {
      var sToday = new Date().toISOString().slice(0, 10);
      // create(initialData, bSkipRefresh, bAtEnd) — bAtEnd:true appends new rows
      // in order; without it V4 inserts at the front and the first line drops to row 2.
      this.byId("itemsTable").getBinding("items").create({
        vatType: "STD", expenseDate: sToday, receiptAttached: false
      }, true, true);
    },

    onDeleteItem: function (oEvent) {
      oEvent.getSource().getBindingContext().delete().catch(this.showError.bind(this));
    },

    onAddMileage: function () {
      var sToday = new Date().toISOString().slice(0, 10);
      // Default the rate from the country's live Policies.mileageRate (loaded into
      // the ui model by _loadTaxRate); fall back to the DB default only if unset.
      var nRate = Number(this.getView().getModel("ui").getProperty("/mileageRate"));
      var sRate = (nRate > 0 ? nRate : 0.25).toString();
      // NOTE: the sap.m.Table aggregation is "items" (bound to {mileageClaims}).
      // bAtEnd:true appends in order (see onAddItem).
      this.byId("mileageTable").getBinding("items").create({
        engineType: "Petrol", ratePerMile: sRate, tripDate: sToday
      }, true, true);
    },

    onDeleteMileage: function (oEvent) {
      oEvent.getSource().getBindingContext().delete().catch(this.showError.bind(this));
    },

    // ---- Receipt upload (CAP media PUT) ------------------------------------
    _getToken: function () {
      if (this._csrf) { return Promise.resolve(this._csrf); }
      var that = this;
      return fetch(this._serviceUrl(), { method: "HEAD", headers: { "x-csrf-token": "Fetch" }, credentials: "same-origin" })
        .then(function (r) { that._csrf = r.headers.get("x-csrf-token"); return that._csrf; });
    },

    _itemUrl: function (oCtx) {
      return this._serviceUrl() + "MyClaimItems(ID=" + oCtx.getProperty("ID") +
        ",IsActiveEntity=" + oCtx.getProperty("IsActiveEntity") + ")/receipt";
    },

    // Supported receipt formats. Kept deliberately narrow (image + PDF) so the
    // backend LargeBinary never receives an unviewable blob; validated both via
    // the picker's `accept` and an explicit check on selection (accept is only a
    // hint — a user can still choose "All files").
    _receiptAccept: ".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf",
    _isAllowedReceipt: function (oFile) {
      var sType = (oFile.type || "").toLowerCase();
      var sName = (oFile.name || "").toLowerCase();
      var aOkTypes = ["image/png", "image/jpeg", "application/pdf"];
      var bOkExt = /\.(png|jpe?g|pdf)$/.test(sName);
      // Some browsers report an empty type for known extensions — accept on extension.
      return (sType && aOkTypes.indexOf(sType) > -1) || (!sType && bOkExt) || (bOkExt && aOkTypes.indexOf(sType) > -1);
    },

    onUploadReceipt: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext();
      if (!oCtx || !oCtx.getProperty("ID")) {
        MessageToast.show(this.getText("msgRowNotReady"));
        return;
      }
      var that = this;
      var oInput = document.createElement("input");
      oInput.type = "file";
      oInput.accept = this._receiptAccept;
      oInput.style.display = "none";
      // Must be in the DOM for the file picker to open reliably across browsers.
      document.body.appendChild(oInput);
      var cleanup = function () { if (oInput.parentNode) { oInput.parentNode.removeChild(oInput); } };
      oInput.onchange = function () {
        var oFile = oInput.files && oInput.files[0];
        cleanup();
        if (!oFile) { return; }
        if (!that._isAllowedReceipt(oFile)) {
          MessageBox.error(that.getText("msgReceiptFormat"));
          return;
        }
        that._putReceipt(oCtx, oFile);
      };
      // Safety net: remove the orphan input if the dialog is cancelled.
      window.addEventListener("focus", function onFocus() {
        window.removeEventListener("focus", onFocus);
        setTimeout(cleanup, 1000);
      });
      oInput.click();
    },

    _putReceipt: function (oCtx, oFile) {
      var sUrl = this._itemUrl(oCtx);
      var that = this;
      // HTTP header values must be ISO-8859-1; a filename with any other character
      // (₹, é, emoji, …) makes fetch() throw synchronously "String contains non
      // ISO-8859-1 code point". Send an ASCII-safe quoted fallback plus the full
      // UTF-8 name via RFC 5987 filename*. (The persisted name is set separately
      // via setProperty below, so this header is only advisory.)
      var sName = oFile.name || "receipt";
      var sAscii = sName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
      var sDisposition = 'inline; filename="' + sAscii + '"; filename*=UTF-8\'\'' + encodeURIComponent(sName);
      this.getView().setBusy(true);
      this._getToken().then(function (sToken) {
        return fetch(sUrl, {
          method: "PUT",
          headers: {
            "x-csrf-token": sToken,
            "Content-Type": oFile.type || "application/octet-stream",
            "Content-Disposition": sDisposition
          },
          body: oFile,
          credentials: "same-origin"
        });
      }).then(function (r) {
        if (!r.ok) { throw new Error("Upload failed (" + r.status + ")"); }
        oCtx.setProperty("receiptAttached", true);
        oCtx.setProperty("receiptFileName", oFile.name);
        that.getView().setBusy(false);
        MessageToast.show(that.getText("msgUploadOk"));
      }).catch(function (e) {
        that.getView().setBusy(false);
        that.showError(e);
      });
    },

    onViewReceipt: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext();
      if (oCtx && oCtx.getProperty("ID")) {
        window.open(this._itemUrl(oCtx), "_blank");
      }
    },

    // ---- Lifecycle ----------------------------------------------------------
    onEdit: function () {
      var that = this;
      var oCtx = this._claimCtx();
      // draftEdit returns a draft that shares the active record's ID with
      // IsActiveEntity=false. Rebind by this computed key rather than the action's
      // return-value-context path — the latter does not reliably resolve to the
      // draft, leaving the form stuck read-only ("Edit does nothing").
      var sDraftPredicate = "ID=" + oCtx.getProperty("ID") + ",IsActiveEntity=false";
      this.getView().setBusy(true);
      this.callAction(oCtx, "ExpenseService.draftEdit", { PreserveChanges: true })
        .then(function () {
          that.getView().setBusy(false);
          that._bindClaim(sDraftPredicate);
        })
        .catch(function (e) {
          that.getView().setBusy(false);
          // A draft may already exist (e.g. an interrupted earlier edit); draftEdit
          // then returns 409. Resume that draft instead of dead-ending on an error.
          var sMsg = (e && (e.message || (e.error && e.error.message))) || "";
          if (/draft.*already exists/i.test(sMsg)) {
            that._bindClaim(sDraftPredicate);
          } else {
            that.showError(e);
          }
        });
    },

    onSave: function () {
      var that = this;
      var oCtx = this._claimCtx();
      // Same ID caveat as onSubmit: resolve from the current draft context (draft
      // and active share the ID), not draftActivate's return-value context.
      var sId = oCtx && oCtx.getProperty("ID");
      if (!sId) {
        this.showError(new Error(this.getText("msgClaimNotReady")));
        return;
      }
      this.getView().setBusy(true);
      // Bind a FRESH canonical draft context for draftActivate (mirrors _doSubmit's
      // activateDraft). Pending field edits still flush in the same $auto batch
      // (grouping drives that, not the action's context), so nothing is lost — and
      // we avoid the view element-binding context, which can make the bound
      // operation read a null internal context ("Cannot read properties of null
      // (reading 'getPath')"). We rebind with $expand right after, so
      // $$inheritExpandSelect is unnecessary.
      var oDraft = this.getModel().bindContext("/MyClaims(ID=" + sId + ",IsActiveEntity=false)").getBoundContext();
      this.callAction(oDraft, "ExpenseService.draftActivate")
        .then(function () {
          that.getView().setBusy(false);
          that._bindClaim("ID=" + sId + ",IsActiveEntity=true");
          MessageToast.show(that.getText("msgSaved"));
        })
        .catch(function (e) { that.getView().setBusy(false); that.showError(e); });
    },

    // Client-side gate: once a mileage row exists it must be complete. Highlights the
    // offending cells inline (valueState) and returns the list of problems. The server
    // rules in srv/lib/validate.js remain the authoritative backstop.
    _validateMileageRows: function () {
      var oTable = this.byId("mileageTable");
      var aItems = oTable ? oTable.getItems() : [];
      // cell index → property (matches the mileage table column order)
      var aReq = [
        { idx: 0, prop: "tripDate" },
        { idx: 1, prop: "destination" },
        { idx: 2, prop: "reasonForTrip" },
        { idx: 4, prop: "milesCount" }
      ];
      var sReq = this.getText("fieldRequired");
      var aProblems = [];
      aItems.forEach(function (oItem, i) {
        var aCells = oItem.getCells();
        var oCtx = oItem.getBindingContext();
        aReq.forEach(function (c) {
          var oCell = aCells[c.idx];
          if (oCell && oCell.setValueState) { oCell.setValueState("None"); }
          if (!oCtx) { return; }
          var v = oCtx.getProperty(c.prop);
          var bMissing = c.prop === "milesCount"
            ? !(Number(v) > 0)
            : !(v && String(v).trim());
          if (bMissing && oCell && oCell.setValueState) {
            oCell.setValueState("Error");
            oCell.setValueStateText(sReq);
            aProblems.push(i + 1);
          }
        });
      });
      return aProblems;
    },

    // Client gate for header + expense-item mandatory fields (mirrors
    // _validateMileageRows). Highlights offending item cells inline (valueState) and
    // returns a list of human-readable problems. The server rules in
    // srv/lib/validate.js remain the authoritative backstop.
    _validateClaimFields: function () {
      var aProblems = [];
      var oCtx = this._claimCtx();
      if (!oCtx || !oCtx.getProperty("claimPeriod")) {
        aProblems.push(this.getText("msgClaimPeriodRequired"));
      }
      var aItems = this.byId("itemsTable") ? this.byId("itemsTable").getItems() : [];
      var nMileage = this.byId("mileageTable") ? this.byId("mileageTable").getItems().length : 0;
      if (!aItems.length && !nMileage) {
        aProblems.push(this.getText("msgNeedOneLine"));
      }
      // cell index → property (matches the expense-item table column order)
      var aReq = [
        { idx: 0, prop: "expenseDate" },
        { idx: 1, prop: "expenseType_code" },
        { idx: 3, prop: "reasonForTrip" },
        { idx: 5, prop: "grossAmount", numeric: true }
      ];
      var sReq = this.getText("fieldRequired");
      var aBadRows = [];
      // Receipt gate (mirrors srv/lib/validate.js Rule 4): a receipt is required
      // when the expense type always needs one OR the gross is at/above the policy
      // threshold. Flag such rows that have no attachment so the user gets an
      // immediate, specific popup instead of a server 422 after submit.
      var aReceiptRows = [];
      var oUi = this.getView().getModel("ui");
      var nThreshold = Number(oUi && oUi.getProperty("/receiptThreshold"));
      var oTypes = this._receiptTypes || {};
      aItems.forEach(function (oItem, i) {
        var aCells = oItem.getCells();
        var oItemCtx = oItem.getBindingContext();
        var bRowBad = false;
        aReq.forEach(function (c) {
          var oCell = aCells[c.idx];
          if (oCell && oCell.setValueState) { oCell.setValueState("None"); }
          if (!oItemCtx) { return; }
          var v = oItemCtx.getProperty(c.prop);
          var bMissing = c.numeric ? !(Number(v) > 0) : !(v && String(v).trim());
          if (bMissing) {
            if (oCell && oCell.setValueState) { oCell.setValueState("Error"); oCell.setValueStateText(sReq); }
            bRowBad = true;
          }
        });
        if (bRowBad) { aBadRows.push(i + 1); }
        if (oItemCtx) {
          var gross = Number(oItemCtx.getProperty("grossAmount")) || 0;
          var sType = oItemCtx.getProperty("expenseType_code");
          var bNeedsReceipt = !!oTypes[sType] || (nThreshold >= 0 && gross >= nThreshold);
          // Use receiptFileName (always set alongside the attachment, and part of
          // the items table's $select) as the "has receipt" signal. Reading
          // receiptAttached here caused a V4 drill-down error because that column
          // isn't referenced in the table, so $$autoExpandSelect never fetches it.
          var bHasReceipt = !!oItemCtx.getProperty("receiptFileName");
          if (bNeedsReceipt && !bHasReceipt) { aReceiptRows.push(i + 1); }
        }
      });
      if (aBadRows.length) { aProblems.push(this.getText("msgItemFieldsMissing", [aBadRows.join(", ")])); }
      if (aReceiptRows.length) { aProblems.push(this.getText("msgReceiptRequired", [aReceiptRows.join(", ")])); }
      return aProblems;
    },

    // Consolidated "please fix these fields" popup.
    _showFieldProblems: function (aProblems) {
      MessageBox.error(this.getText("msgFieldsIncomplete") + "\n\n• " + aProblems.join("\n• "));
    },

    // A failed bound action in a $batch surfaces the real 4xx text via the Message
    // Manager (see BaseController._backendMessage). A leftover sibling draft holding
    // the CAP draft lock produces "409 Entity locked" — detect it to self-heal.
    _isEntityLocked: function (oErr) {
      var s = (this._backendMessage(oErr) || (oErr && oErr.message) || "");
      return /lock/i.test(s) || (oErr && (oErr.status === 409 || oErr.statusCode === 409));
    },

    onSubmit: function () {
      var that = this;
      var oCtx = this._claimCtx();
      // Resolve the ID from the CURRENT context up front. Draft and active records
      // share the same ID, so we must NOT read it from draftActivate's return-value
      // context — that does not reliably expose the key synchronously and yields
      // ID=undefined (same reason onEdit computes its own predicate). See below.
      var sId = oCtx && oCtx.getProperty("ID");
      if (!sId) {
        this.showError(new Error(this.getText("msgClaimNotReady")));
        return;
      }

      // Client-side mandatory checks (header + item + mileage) BEFORE any server
      // round-trip, so a missing field gives an immediate, specific popup.
      var aProblems = this._validateClaimFields();
      if (this._validateMileageRows().length) { aProblems.push(this.getText("msgMileageIncomplete")); }
      if (aProblems.length) { this._showFieldProblems(aProblems); return; }

      // Confirm before applying — and name the approver the claim will be sent to
      // (resolved per country via the ExpenseService function import). On OK the
      // submit runs; the backend then emails that approver (fire-and-forget).
      var that2 = this;
      var sCountry = oCtx.getProperty("country");
      this._resolveApprover(sCountry).then(function (sApprover) {
        var sMsg = sApprover
          ? that2.getText("confirmSubmitNamed", [sApprover, that2._approverRole(sCountry)])
          : that2.getText("confirmSubmitGeneric");
        MessageBox.confirm(sMsg, {
          title: that2.getText("confirmSubmitTitle"),
          actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
          emphasizedAction: MessageBox.Action.OK,
          onClose: function (sAction) {
            if (sAction === MessageBox.Action.OK) { that2._doSubmit(oCtx, sId); }
          }
        });
      });
    },

    // Resolve the country's first-level approver email via the OData function
    // import (NOT a raw fetch — that would 404 under the Work Zone approuter).
    // Never rejects: resolves to "" on any failure so the lookup can never block
    // submit — the confirmation then falls back to a generic message.
    _resolveApprover: function (sCountry) {
      if (!sCountry) { return Promise.resolve(""); }
      try {
        // V4 operation binding MUST be deferred: the path ends with the literal
        // "(...)" and parameters are supplied via setParameter — NOT inlined in
        // the path (that form is not a deferred binding, so execute() throws
        // "The binding must be deferred" synchronously and breaks onSubmit).
        var oOp = this.getModel().bindContext("/approverFor(...)");
        oOp.setParameter("country", sCountry);
        return oOp.execute().then(function () {
          var oBound = oOp.getBoundContext();
          return (oBound && oBound.getProperty("value")) || "";
        }).catch(function () { return ""; });
      } catch (e) {
        // Never let the approver lookup block submit — fall back to the generic
        // confirmation message.
        return Promise.resolve("");
      }
    },

    // Human label for the approver level (UK routes through a 1st-level approver;
    // India is single-level).
    _approverRole: function (sCountry) {
      return this.getText(sCountry === "UK" ? "approverRoleUK" : "approverRoleGeneric");
    },

    // The actual submit chain (was inline in onSubmit). Activates a stale sibling
    // draft to release the CAP lock on a 409, then retries once.
    _doSubmit: function (oCtx, sId) {
      var that = this;
      var bDraft = oCtx.getPath().indexOf("IsActiveEntity=false") > -1;
      this.getView().setBusy(true);

      var submitActive = function () {
        var oActive = that.getModel().bindContext("/MyClaims(ID=" + sId + ",IsActiveEntity=true)").getBoundContext();
        return that.callAction(oActive, "ExpenseService.submitClaim");
      };
      // Activating a sibling draft folds its edits into the active row and RELEASES
      // the CAP draft lock — this is how we recover from "409 Entity locked".
      var activateDraft = function () {
        var oDraft = that.getModel().bindContext("/MyClaims(ID=" + sId + ",IsActiveEntity=false)").getBoundContext();
        return that.callAction(oDraft, "ExpenseService.draftActivate", {}, { $$inheritExpandSelect: true });
      };

      // If we're on the draft, activate it first (unchanged). Then submit the active.
      // If submit hits a 409 lock, a stale sibling draft holds it → activate that
      // draft (user chose "activate then submit") and retry once.
      var pStart = bDraft ? activateDraft() : Promise.resolve();
      pStart
        .then(submitActive)
        .catch(function (oErr) {
          if (that._isEntityLocked(oErr)) { return activateDraft().then(submitActive); }
          throw oErr;
        })
        .then(function () {
          that.getView().setBusy(false);
          MessageToast.show(that.getText("msgSubmitted"));
          that.navTo("list");
        })
        .catch(function (e) {
          that.getView().setBusy(false);
          // Show the real backend message FIRST (while it is still in the Message
          // Manager), THEN rebind — the old order rebound before throwing, which
          // stripped the 422/409 message before showError could read it.
          that.showError(e);
          that._bindClaim("ID=" + sId + ",IsActiveEntity=true");
        });
    },

    onDiscard: function () {
      var that = this;
      MessageBox.warning(this.getText("confirmDiscard"), {
        title: this.getText("confirmDiscardTitle"),
        actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
        emphasizedAction: MessageBox.Action.OK,
        onClose: function (sAction) {
          if (sAction !== MessageBox.Action.OK) { return; }
          that.getView().setBusy(true);
          that._claimCtx().delete().then(function () {
            that.getView().setBusy(false);
            MessageToast.show(that.getText("msgDiscarded"));
            that.navTo("list");
          }).catch(function (e) { that.getView().setBusy(false); that.showError(e); });
        }
      });
    },

    onBack: function () {
      this.navTo("list");
    }
  });
});
