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

  var SVC = "/expense";

  return BaseController.extend("com.bluestonex.expense.myexpenses.controller.Claim", {

    formatter: formatter,

    onInit: function () {
      this.getView().setModel(new JSONModel({ editable: false, canEdit: false, canSubmit: false, itemCount: 0, mileageCount: 0, stdRate: 0, currency: "GBP" }), "ui");
      this.getRouter().getRoute("detail").attachPatternMatched(this._onMatched, this);
    },

    onItemsUpdated: function (oEvent) {
      this.getView().getModel("ui").setProperty("/itemCount", oEvent.getParameter("total") || 0);
    },

    onMileageUpdated: function (oEvent) {
      this.getView().getModel("ui").setProperty("/mileageCount", oEvent.getParameter("total") || 0);
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
            var bDraft = !sStatus || sStatus === "Draft";
            oUi.setProperty("/canSubmit", bDraft);
            oUi.setProperty("/canEdit", !bEditable && bDraft);
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
      var oUi = this.getView().getModel("ui");
      if (!sCountry) { oUi.setProperty("/stdRate", 0); return; }
      var oList = this.getModel().bindList("/Policies", null, null, [
        new Filter("country", FilterOperator.EQ, sCountry)
      ]);
      oList.requestContexts(0, 1).then(function (aCtx) {
        var rate = 0;
        if (aCtx.length) {
          var p = aCtx[0].getObject();
          rate = Number(sCountry === "IN" ? p.gstRate : p.vatRate) || 0;
        }
        oUi.setProperty("/stdRate", rate);
      }).catch(function () { oUi.setProperty("/stdRate", 0); });
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
      // NOTE: the sap.m.Table aggregation is "items" (bound to {mileageClaims}).
      // bAtEnd:true appends in order (see onAddItem).
      this.byId("mileageTable").getBinding("items").create({
        engineType: "Petrol", ratePerMile: "0.25", tripDate: sToday
      }, true, true);
    },

    onDeleteMileage: function (oEvent) {
      oEvent.getSource().getBindingContext().delete().catch(this.showError.bind(this));
    },

    // ---- Receipt upload (CAP media PUT) ------------------------------------
    _getToken: function () {
      if (this._csrf) { return Promise.resolve(this._csrf); }
      var that = this;
      return fetch(SVC + "/", { method: "HEAD", headers: { "x-csrf-token": "Fetch" }, credentials: "same-origin" })
        .then(function (r) { that._csrf = r.headers.get("x-csrf-token"); return that._csrf; });
    },

    _itemUrl: function (oCtx) {
      return SVC + "/MyClaimItems(ID=" + oCtx.getProperty("ID") +
        ",IsActiveEntity=" + oCtx.getProperty("IsActiveEntity") + ")/receipt";
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
      oInput.accept = "image/*,application/pdf";
      oInput.style.display = "none";
      // Must be in the DOM for the file picker to open reliably across browsers.
      document.body.appendChild(oInput);
      var cleanup = function () { if (oInput.parentNode) { oInput.parentNode.removeChild(oInput); } };
      oInput.onchange = function () {
        var oFile = oInput.files && oInput.files[0];
        cleanup();
        if (oFile) { that._putReceipt(oCtx, oFile); }
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
      this.getView().setBusy(true);
      this._getToken().then(function (sToken) {
        return fetch(sUrl, {
          method: "PUT",
          headers: {
            "x-csrf-token": sToken,
            "Content-Type": oFile.type || "application/octet-stream",
            "Content-Disposition": 'inline; filename="' + oFile.name + '"'
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
      this.callAction(oCtx, "ExpenseService.draftActivate", {}, { $$inheritExpandSelect: true })
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

      // A mileage row, once added, must have all mandatory fields (Apply-for-Approval
      // only — draft Save stays permissive). Abort with inline highlights if not.
      if (this._validateMileageRows().length) {
        this.showError(new Error(this.getText("msgMileageIncomplete")));
        return;
      }
      var bDraft = oCtx.getPath().indexOf("IsActiveEntity=false") > -1;
      this.getView().setBusy(true);

      // Validation runs inside submitClaim on the ACTIVE record, so activate the
      // draft first (if we are on one), then submit against the active entity.
      var pActivate = bDraft
        ? this.callAction(oCtx, "ExpenseService.draftActivate", {}, { $$inheritExpandSelect: true })
        : Promise.resolve();

      pActivate
        .then(function () {
          var oActive = that.getModel().bindContext("/MyClaims(ID=" + sId + ",IsActiveEntity=true)").getBoundContext();
          return that.callAction(oActive, "ExpenseService.submitClaim").then(function () {
            that.getView().setBusy(false);
            MessageToast.show(that.getText("msgSubmitted"));
            that.navTo("list");
          }, function (oErr) {
            // Submit rejected (e.g. validation 422): the draft is now an active Draft.
            // Rebind so the page reflects the saved active record (Edit to fix & retry).
            that.getView().setBusy(false);
            that._bindClaim("ID=" + sId + ",IsActiveEntity=true");
            throw oErr;
          });
        })
        .catch(function (e) { that.getView().setBusy(false); that.showError(e); });
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
