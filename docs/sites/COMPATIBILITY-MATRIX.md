# Sites compatibility evidence — 2026-10-22

Sources: [Sites overview](https://learn.chatgpt.com/docs/sites) (S1),
[creating and using Sites](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites) (S2),
[residency](https://help.openai.com/en/articles/9903489-data-residency-and-inference-residency-for-chatgpt) (S3),
[Sites terms](https://openai.com/policies/chatgpt-sites-terms/) (S4), and the installed
Sites development skill, version 1.1.1 (S5). Sources checked on the date above.
Application evidence is separate from platform support. Unknowns remain gates.

| Need | Assessment | Evidence / remaining gate |
|---|---|---|
| R1 Next server rendering/actions/middleware | Supported with adaptation; full parity pending | S5 uses Worker output and the Sites build integration; prior Vinext deployment renders sign-in and nonce headers. Authenticated server-action acceptance remains open. |
| R2 Node APIs | Supported with changes on a per-API basis | S5 Worker runtime; Node declarations do not prove compatibility. Inventory and exercise actual APIs. |
| R3 Virus scanning | Supported with an external service; service not provisioned | S1 excludes raw TCP. HTTPS adapter and external deployment candidate added; real ClamAV/TLS tests remain open. |
| R4 Email | Supported through HTTPS provider | S1 supports HTTPS, not raw TCP. Approved delivery and retry tests remain open. |
| R5 Outbound HTTPS | Supported at transport level | S1; service-specific authentication, destinations and callbacks must be tested. |
| R6 Incoming jobs/webhooks | Supported as HTTP requests; handler acceptance pending | S1/S2 public website access. Do not interpret this as support for persistent background daemons. |
| R7 Time/size/memory | Release blocker until workload proven | S5 specifies 128 MB per isolate. Exact request/CPU/body/response ceilings were not established from reviewed public pages. No generic Cloudflare quota is substituted. |
| R8 Public member access | Supported | S2 public publishing depends on workspace controls; staging is already public with app sign-in. |
| R9 Separate environments | Supported through separate Sites | S2 permits multiple Sites subject to shared quotas. Separate builds/configuration required. Custom-domain availability remains to be verified before promising it. |
| R10 Headers | Prior smoke checks passed; recheck final candidate | Current app produces headers; platform documentation alone does not establish nonce correctness across authenticated flows. |
| R11 Location/privacy | Production approval gate | S3 now describes regional hosting for new US/EU-residency Sites; other residency regions do not currently apply to Sites. Existing Sites do not automatically move. Do not assume Quebec hosting. |
| R12 Data terms | Owner/privacy review required | S4 section 3.3 excludes PHI and direct payment-card processing; other sensitive data requires applicable-law compliance. No blanket permission for the app's full dataset is inferred. |

The handoff's statement that residency is entirely unsupported at launch is
outdated; it still does not establish Canadian hosting for this Site. Production
requires a documented data-flow and contractual review by the designated owner.

Recommendation: continue staging engineering; production is not approved by this
matrix. Runtime workload limits, real scanner deployment, authenticated parity,
privacy review and rehearsed recovery are mandatory unresolved gates.
