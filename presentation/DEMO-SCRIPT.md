# BluestoneX Expenses — Management Demo Run-Sheet
**Audience:** Finance + IT leadership + CEO · **Goal:** approval to roll out org-wide · **Length:** ~10 min live demo · **Tone:** outcomes first, tech second.

> **One-line positioning (open and close with this):**
> *"We replaced the emailed Excel expense form with one digital system that handles both UK and India, enforces our policy automatically, and gives management live spend visibility — and it's already running on SAP BTP."*

---

## Before you present — 2-minute pre-flight (do this, don't skip)
- [ ] **Dry-run the full flow end-to-end once**, on the same login you'll demo with, 10 min before.
- [ ] Log in as an **employee who exists in the org directory** (name greets correctly, e.g. `suresh.rajarathinam@bluestonex.com`).
- [ ] Have a **second login ready** (the configured approver) — or a second browser/incognito — so the "switch hats" moment is instant.
- [ ] Pre-open the **Approval → Dashboard** in a second tab so the analytics are already loaded when you get there.
- [ ] Keep DevTools **closed** on the screen you present.
- [ ] Have **one sentence of fallback**: if anything lags, *"this is our BTP prototype — production sizing is a config setting."* Then move on.

---

## PART 1 — Timed live-demo script (the spine, ~10 min)

Format per step → **[time] What you click · What they see · "SAY THIS" (spoken) · Value to land.**

### ① Hook — the "before" (0:45)
- **Click:** nothing yet — one slide or just speak.
- **They see:** you, confident.
- **SAY THIS:** *"Today, an expense claim is an Excel form emailed around for signatures — slow, manual, no visibility, and hard to keep compliant across UK and India. Here's what we built instead."*
- **Value:** frames the pain everyone already feels. Keep it to two sentences.

### ② Employee creates a claim — country picks the rules (2:00)
- **Click:** My Expenses → **Create** → choose **India** (then mention UK). App greets the employee **by name**.
- **They see:** the claim opens with **country, currency (₹ INR), and tax type (GST)** already tailored; header shows employee number + site pulled from the directory — nothing typed.
- **SAY THIS:** *"The employee just picks their country. The system instantly applies the right tax — GST for India, VAT for the UK — the right currency, and pulls their details from our HR directory. No forms, no lookups."*
- **Value:** **country-aware compliance, zero manual setup.** One system, both countries.

### ③ Add items + mileage + receipt — live tax preview (1:30)
- **Click:** add an expense line, type a **Gross** amount; add a **Mileage** row; **attach a receipt** to a line.
- **They see:** **Net and Tax split appear live** next to Gross as you type; mileage totals at the per-mile rate.
- **SAY THIS:** *"As they type, the system splits net and tax automatically — the numbers finance needs are calculated for them, not by them. Receipts attach to each line, so nothing gets lost."*
- **Value:** **accuracy + no re-keying by finance.** Receipts are captured at source.

### ④ Apply for Approval — it names the approver (1:00)
- **Click:** **Apply for Approval.** A popup names **exactly who** it's going to.
- **They see:** *"This will be sent to \<approver name\>"* → confirm → success toast.
- **SAY THIS:** *"When they submit, the system tells them exactly who it's going to — and emails that approver automatically. No chasing, no 'who signs this?'."*
- **Value:** **routing is automatic and transparent.** (If email is enabled, mention the approver just got an email.)

### ⑤ Switch hats — the approver decides (2:00)
- **Click:** switch to the **approver** login → **Approval → Approvals**. Open a pending claim → **Review** → **Approve** (or **Return for rework** with a comment).
- **They see:** the pending queue, the full claim with net/tax, any **policy-flag warning** (e.g. over daily limit), and a one-click decision → the claimant is emailed the outcome.
- **SAY THIS:** *"The approver sees everything in one place, including any policy breaches flagged automatically, and approves or returns it in one click. The employee is emailed the result — and it's all recorded."*
- **Value:** **enforced policy + full audit trail.** Faster, defensible decisions.

### ⑥ Same system, different countries (1:00)
- **Click:** point to the routing (or the Workflow Members tab).
- **They see:** UK claim needs **two** approvals (L1 → L2); India needs **one** (L1).
- **SAY THIS:** *"UK needs two levels of sign-off, India needs one. Same system — that's a configuration setting, not new software. New country, new limit, new approver? We change a setting, not the code."*
- **Value:** **config-driven — grows with us, no dev project each time.**

### ⑦ The management view — live analytics (1:30)
- **Click:** **Approval → Dashboard** (pre-loaded). Toggle **UK £ / India ₹**; adjust the date range.
- **They see:** KPI tiles, **spend by category** (including mileage), **Total reimbursed** donut, **Top-5 claimants**, **submitted/approved/returned trend**, **spend by country**, and a **policy-violation rate** — currencies kept separate (£ vs ₹).
- **SAY THIS:** *"And here's what you get that a spreadsheet never could — live spend by category, by person, by country, and how well we're sticking to policy. Real numbers, updated as claims flow."*
- **Value:** **real-time spend visibility + compliance insight** for management.

### ⑧ Close — the ask (0:15)
- **SAY THIS:** *"That's the whole journey — claim to cash — for UK and India, already live on SAP BTP. I'd like your go-ahead to roll it out across the organisation."*
- **Value:** end on the decision. Then stop talking.

**Total: ~10:00.**

---

## PART 2 — Speaker notes & highlight callouts (what to emphasise, and the objection each kills)

| # | Headline benefit (what they remember) | HIGHLIGHT (slow down, point here) | Objection it pre-empts |
|---|----------------------------------------|-----------------------------------|------------------------|
| ② | One system, both countries | The moment tax/currency changes just from picking a country | *"Do we need separate tools for UK and India?"* → No. |
| ② | No manual data entry | Employee name/number/site appear without typing | *"More admin work?"* → It reads our directory. |
| ③ | Finance-ready numbers, automatically | Net/Tax appearing live as Gross is typed | *"Will the tax maths be wrong / re-keyed?"* → Calculated at source. |
| ③ | Receipts captured at source | Attaching a receipt to a line | *"We still lose receipts."* → Attached per line, kept with the claim. |
| ④ | Transparent, automatic routing | The popup naming the approver | *"Who approves this / chasing signatures."* → System routes + emails. |
| ⑤ | Policy enforced, not hoped-for | The auto policy-flag warning on the claim | *"How do we control overspend?"* → Flagged automatically for the approver. |
| ⑤ | Fully auditable | "every decision is recorded" | *"Can we defend this in an audit?"* → Complete trail. |
| ⑥ | Config-driven, future-proof | UK 2-level vs India 1-level as a setting | *"Every change is a dev project."* → Rules are configuration. |
| ⑦ | Management gets visibility | The £/₹ toggle + trend + violation rate | *"We're flying blind on spend."* → Live analytics. |
| all | Already real | "running on SAP BTP today" | *"Is this just slides?"* → It's live. |

**Delivery reminders:** short sentences · say the *benefit* before the *feature* · pause on each HIGHLIGHT for 2 seconds · never read the screen aloud — say what it *means*.

---

## PART 3 — Leave-behind deck outline (8 slides, title + 3 bullets)

1. **The problem today**
   - Expense claims run on an emailed Excel form
   - Slow approvals, lost receipts, manual re-keying by finance
   - No spend visibility, inconsistent policy across UK & India

2. **Our solution**
   - One digital system: claim → approval → analytics
   - Built for **UK and India** out of the box
   - Live on **SAP BTP** today (working prototype)

3. **The employee experience**
   - Pick country → tax, currency & rules auto-applied
   - Inline items + mileage + per-line receipts
   - Live Net/Tax preview; one-click Apply for Approval

4. **Country-aware compliance**
   - UK = VAT · India = GST (from central config)
   - Currencies kept separate (£ / ₹) — never mixed
   - Correct tax & limits enforced automatically

5. **Approvals & audit**
   - UK two-level, India single-level routing
   - Automatic email to the right approver at each step
   - Policy breaches auto-flagged · every action logged

6. **Management analytics**
   - Spend by category (incl. mileage), by person, by country
   - Approved-spend trend + policy-violation rate
   - Filter by date and country, £/₹ toggle

7. **Why it matters**
   - Faster reimbursements, less finance admin
   - Built-in tax compliance + defensible audit trail
   - New country/limit/approver = a setting, **not code**

8. **The ask**
   - Approve org-wide rollout
   - Next: production sizing + user onboarding + go-live plan
   - *(Optional one-liner: built on SAP CAP + SAPUI5 on BTP — standard, supportable SAP tech.)*

---

## Q&A prep — likely questions, crisp answers
- **"Is it secure / who can see what?"** — Role-based: employees see only their own claims; approvers see their queue; admins configure policy. Access is via SAP's standard identity (XSUAA).
- **"What happens when tax rates or limits change?"** — A configuration change in the Policy screen. No development, no redeploy of logic.
- **"Can it handle more countries?"** — Yes — routing, tax and limits are config-driven; adding a country is configuration, not a rebuild.
- **"How much to run it?"** — It's standard SAP BTP; running cost is a sizing setting. We'll bring exact numbers with the rollout plan.
- **"Is the data trustworthy?"** — Employee data comes from our live org directory (single source of truth); every claim change is audit-logged.
- **"How far along is it?"** — Working prototype deployed on BTP, covering the full claim-to-approval journey for UK and India, with automated tests.

> Keep the tech answer to one sentence, then steer back to the benefit.
