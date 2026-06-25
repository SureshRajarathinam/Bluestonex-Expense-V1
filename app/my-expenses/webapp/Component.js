sap.ui.define([
  "sap/ui/core/UIComponent"
], function (UIComponent) {
  "use strict";

  return UIComponent.extend("com.bluestonex.expense.myexpenses.Component", {
    metadata: {
      manifest: "json",
      interfaces: ["sap.ui.core.IAsyncContentCreation"]
    },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);
      // Initialise the router after the root view (ToolPage shell) is ready.
      this.getRouter().initialize();
    }
  });
});
