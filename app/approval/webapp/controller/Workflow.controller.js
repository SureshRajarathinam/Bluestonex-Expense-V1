sap.ui.define([
  "com/bluestonex/expense/approval/controller/BaseController",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast"
], function (BaseController, JSONModel, MessageToast) {
  "use strict";

  function initialsOf(sName) {
    if (!sName) { return "?"; }
    var p = sName.trim().split(/\s+/);
    return (p[0].charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : "")).toUpperCase();
  }

  return BaseController.extend("com.bluestonex.expense.approval.controller.Workflow", {

    onInit: function () {
      this.getView().setModel(new JSONModel({ rows: [], employees: [] }), "wf");
      this._snap = {};
      this._load();
    },

    onRefresh: function () { this._load(); },

    _freshCtx: function (sCountry, bActive) {
      return this.getModel()
        .bindContext("/WorkflowMembers(country='" + sCountry + "',IsActiveEntity=" + bActive + ")")
        .getBoundContext();
    },

    _load: function () {
      var that = this;
      var oModel = this.getModel();
      this.getView().setBusy(true);

      var pEmp = oModel.bindList("/Employees", null, null, null, { $$groupId: "$direct" })
        .requestContexts(0, 1000)
        .then(function (aCtx) {
          return aCtx.map(function (c) { return { email: c.getProperty("email"), fullName: c.getProperty("fullName") }; });
        });
      var pWf = oModel.bindList("/WorkflowMembers", null, null, null, { $$groupId: "$direct" })
        .requestContexts(0, 100)
        .then(function (aCtx) { return aCtx.map(function (c) { return c.getObject(); }); });

      Promise.all([pEmp, pWf]).then(function (aRes) {
        var aEmp = aRes[0];
        var mName = {};
        aEmp.forEach(function (e) { mName[e.email] = e.fullName; });
        var name = function (email) { return mName[email] || email || "—"; };

        var aRows = aRes[1].map(function (m) {
          return {
            country: m.country,
            countryName: m.countryName,
            twoLevel: m.country === "UK",
            chainType: m.country === "UK" ? that.getText("chainTwoLevel") : that.getText("chainSingleLevel"),
            firstApprover: m.firstApprover,
            firstName: name(m.firstApprover),
            firstInitials: initialsOf(name(m.firstApprover)),
            secondApprover: m.secondApprover,
            secondName: name(m.secondApprover),
            secondInitials: initialsOf(name(m.secondApprover)),
            editing: false
          };
        });
        var oWf = that.getView().getModel("wf");
        oWf.setProperty("/employees", aEmp);
        oWf.setProperty("/rows", aRows);
        that.getView().setBusy(false);
      }).catch(function (e) { that.getView().setBusy(false); that.showError(e); });
    },

    _rowCtx: function (oEvent) {
      return oEvent.getSource().getBindingContext("wf");
    },

    onEditCard: function (oEvent) {
      var oCtx = this._rowCtx(oEvent);
      var oWf = this.getView().getModel("wf");
      // collapse all other cards, snapshot this one for cancel
      oWf.getProperty("/rows").forEach(function (r, i) {
        oWf.setProperty("/rows/" + i + "/editing", false);
      });
      var o = oCtx.getObject();
      this._snap[o.country] = { firstApprover: o.firstApprover, secondApprover: o.secondApprover };
      oCtx.getModel().setProperty(oCtx.getPath() + "/editing", true);
    },

    onCancelCard: function (oEvent) {
      var oCtx = this._rowCtx(oEvent);
      var o = oCtx.getObject();
      var snap = this._snap[o.country];
      if (snap) {
        oCtx.getModel().setProperty(oCtx.getPath() + "/firstApprover", snap.firstApprover);
        oCtx.getModel().setProperty(oCtx.getPath() + "/secondApprover", snap.secondApprover);
      }
      oCtx.getModel().setProperty(oCtx.getPath() + "/editing", false);
    },

    onSaveCard: function (oEvent) {
      var that = this;
      var oCtx = this._rowCtx(oEvent);
      var oWf = oCtx.getModel();
      var sPath = oCtx.getPath();
      var o = oCtx.getObject();

      if (!o.firstApprover || (o.twoLevel && !o.secondApprover)) {
        MessageToast.show(that.getText("selectApprover"));
        return;
      }
      this.getView().setBusy(true);
      var oModel = this.getModel();

      // draftEdit the active row, load the draft, PATCH it, flush, then draftActivate.
      this.callAction(this._freshCtx(o.country, "true"), "ApprovalService.draftEdit", { PreserveChanges: false })
        .then(function () {
          var oDraft = oModel
            .bindContext("/WorkflowMembers(country='" + o.country + "',IsActiveEntity=false)", null, { $$updateGroupId: "$auto" })
            .getBoundContext();
          return oDraft.requestObject().then(function () {
            oDraft.setProperty("firstApprover", o.firstApprover);
            oDraft.setProperty("secondApprover", o.twoLevel ? o.secondApprover : null);
            return oModel.submitBatch("$auto");
          }).then(function () {
            return that.callAction(that._freshCtx(o.country, "false"), "ApprovalService.draftActivate");
          });
        })
        .then(function () {
          // refresh resolved name/initials from the employee list, exit edit mode
          var aEmp = oWf.getProperty("/employees") || [];
          var nameOf = function (email) {
            var hit = aEmp.filter(function (e) { return e.email === email; })[0];
            return hit ? hit.fullName : (email || "—");
          };
          oWf.setProperty(sPath + "/firstName", nameOf(o.firstApprover));
          oWf.setProperty(sPath + "/firstInitials", initialsOf(nameOf(o.firstApprover)));
          oWf.setProperty(sPath + "/secondName", nameOf(o.secondApprover));
          oWf.setProperty(sPath + "/secondInitials", initialsOf(nameOf(o.secondApprover)));
          oWf.setProperty(sPath + "/editing", false);
          that.getView().setBusy(false);
          MessageToast.show(that.getText("msgWorkflowSaved"));
        })
        .catch(function (e) { that.getView().setBusy(false); that.showError(e); });
    }
  });
});
