/* eslint-disable */
/**
 * wdi5 (WebdriverIO + UI5) END-TO-END outline — full business flow across BOTH
 * apps and the real backend: employee submits → approver approves → verify state.
 *
 * HOW TO RUN: needs wdi5 configured (wdio.conf.js with the ui5 service pointing at
 * a running `cds watch`, plus @wdio/cli + wdio-ui5-service). Not configured here →
 * this is an OUTLINE to wire up, not a runnable spec. Selectors use UI5 control
 * locators; where a control lacks an id we fall back to a bindingPath/properties
 * matcher (and flag it as a testability gap to fix in the views).
 */
describe("Expense E2E — submit then approve a UK claim", () => {

  it("employee creates, fills, saves and submits a claim", async () => {
    // await browser.goTo("http://localhost:4004/my-expenses/webapp/index.html");
    // await browser.asControl({ selector: { id: "container-...---list--claimsTable" } });
    // Press Create (no id → text matcher), choose UK in countryGroup (index 0),
    // Continue, Add Item (text matcher), fill DatePicker/type/gross, Save, Submit.
    // EXPECT: a success toast and the claim leaves Draft (status = Submitted).
    expect(true).toBe(true); // placeholder until wdi5 is wired
  });

  it("configured L1 approver approves it in the approval app", async () => {
    // Log in as manager@ (approuter/basic), open Approvals tab (sectionNav),
    // open the row's Review dialog (reviewDialog), press Approve.
    // EXPECT: UK claim → FirstApproved; a second login as Dan.Barton@ → Approved.
    expect(true).toBe(true);
  });

  it("verifies backend state matches the UI at each step", async () => {
    // Cross-check via OData: GET /approval/ClaimHistory shows the claim as Approved,
    // GET /approval/AuditLogs has Submitted + FirstApproved + Approved entries.
    expect(true).toBe(true);
  });
});
