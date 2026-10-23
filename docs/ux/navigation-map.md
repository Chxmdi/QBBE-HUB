# Navigation coverage

Generated from the shared navigation definitions. Routes and permission predicates are retained; the existing wos_home switch chooses the consolidated presentation. Replaced routes remain in Classic screens under All tools. Server authorization remains authoritative.

| Feature | Route | Minimum access | Feature switch | Previous group | Work area | Replaces |
|---|---|---|---|---|---|---|
| Home | / | member | Always | Work | Today | — |
| Home | /home | member | wos_home | Work | Today | / |
| My World | /home/world | member | wos_home | Work | Today | — |
| Capture | /capture | member | wos_capture | Work | Today | — |
| My Work | /my-work | member | Always | Work | My Work | — |
| My Work | /lenses/my-work | member | wos_lenses | Work | My Work | /my-work |
| Board | /board | member | Always | Work | My Work | — |
| Board | /lenses/board | member | wos_lenses | Work | My Work | /board |
| Approvals | /approvals | staff | Always | Work | My Work | — |
| Requests | /requests | member | Always | Work | My Work | — |
| Forms | /forms | member | Always | Work | My Work | — |
| Forms | /forms-v2 | member | wos_forms_v2 | Work | My Work | /forms |
| Signatures | /signatures | member | Always | Organization | My Work | — |
| Channels | /channels | member | Always | Communication | Messages | — |
| Messages | /messages | member | Always | Communication | Messages | — |
| Announcements | /announcements | member | Always | Communication | Messages | — |
| Saved | /saved | member | Always | Communication | Messages | — |
| People | /people | member | Always | Organization | Messages | — |
| Programs | /programs | member | Always | Work | Programs & Projects | — |
| Projects | /projects | member | Always | Work | Programs & Projects | — |
| Goals | /goals | member | wos_goals | Work | Programs & Projects | — |
| Pages | /pages | member | wos_pages | Workspace | Knowledge | — |
| Documents | /documents | member | Always | Organization | Knowledge | — |
| Spaces | /spaces | member | wos_spaces | Workspace | Knowledge | — |
| Templates | /templates-v2 | member | wos_objects | Workspace | Knowledge | — |
| Apps | /apps | member | wos_objects | Workspace | Knowledge | — |
| Trash | /collab/trash | member | wos_editor | Workspace | Knowledge | — |
| Calendar | /calendar | member | Always | Organization | Calendar | — |
| Calendar | /lenses/calendar | member | wos_lenses | Organization | Calendar | /calendar |
| Master Schedule | /schedule | member | Always | Organization | Calendar | — |
| Meetings | /meetings | member | Always | Organization | Calendar | — |
| Meeting notes | /meetings-v2 | member | wos_meetings_v2 | Organization | Calendar | — |
| Events | /events | member | Always | Organization | Calendar | — |
| Relationships | /crm | staff | Always | Organization | Relationships | — |
| Receipts | /finance/receipts | staff | Always | Organization | Finance | — |
| Bills & invoices | /finance/payables | staff | Always | Organization | Finance | — |
| Ledger | /finance/ledger | ledger | Always | Organization | Finance | — |
| Budgets | /finance/budgets | ledger | Always | Organization | Finance | — |
| GST and QST | /finance/sales-tax | ledger | Always | Organization | Finance | — |
| Bank | /finance/bank | ledger | Always | Organization | Finance | — |
| Gifts and grants | /finance/gifts | ledger | Always | Organization | Finance | — |
| Payroll | /finance/payroll | ledger | Always | Organization | Finance | — |
| Reports | /reports | staff | Always | Organization | Reports & Views | — |
| Saved lenses | /lenses | member | wos_lenses | Lenses | Reports & Views | — |
| Table | /lenses/table | member | wos_lenses | Lenses | Reports & Views | — |
| Timeline | /lenses/timeline | member | wos_lenses | Lenses | Reports & Views | — |
| Gallery | /lenses/gallery | member | wos_lenses | Lenses | Reports & Views | — |
| Feed | /lenses/feed | member | wos_lenses | Lenses | Reports & Views | — |
| Dashboards | /lenses/dashboard | member | wos_lenses | Lenses | Reports & Views | — |
| Insight dashboards | /insight/dashboards | member | wos_lenses | Insight | Reports & Views | — |
| Operations | /insight/operations | member | wos_lenses | Insight | Reports & Views | — |
| Relationship graph | /insight/graph | member | wos_lenses | Insight | Reports & Views | — |
| Map | /insight/map | member | wos_lenses | Insight | Reports & Views | — |
| How work flows | /insight/process | member | wos_lenses | Insight | Reports & Views | — |
| What-if timeline | /insight/what-if | member | wos_lenses | Insight | Reports & Views | — |
| Inbox | /inbox | member | Always | Communication | Utilities | — |
| Following | /following | member | wos_objects | Communication | Utilities | — |
| Find | /lenses/find | member | wos_lenses | Lenses | Utilities | — |
| Commands | /home/commands | member | wos_home | Workspace | Utilities | — |
| Work offline | /offline | member | wos_offline | Workspace | Utilities | — |
| Phone screens | /m | member | wos_mobile | Workspace | Utilities | — |
| Admin | /admin | admin | Always | Organization | Setup | — |
| Blueprints | /builder | staff | wos_objects | Workspace | Setup | — |
| Page layouts | /collab/layouts | staff | wos_editor | Workspace | Setup | — |
| Workflows | /workflows | admin | wos_workflows_v2 | Setup | Setup | — |
| API access tokens | /api-tokens | staff | wos_workflows_v2 | Setup | Setup | — |
| Workspace upkeep | /upkeep | staff | wos_objects | Workspace | Setup | — |
| Access and sign-in | /spaces/admin | admin | wos_spaces | Setup | Setup | — |
| Roles | /spaces/roles | admin | wos_spaces | Setup | Setup | — |
| Public pages | /spaces/publish | admin | wos_public_pages | Setup | Setup | — |
