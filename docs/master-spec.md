# QBBE Hub Master Product, UI/UX & Development Specification

> **What this file is.** The build brief handed to the implementation effort on
> 2026-08-18 — not the specification it refers to. Its own opening line points
> at the "QBBE Hub Master Product, UI/UX & Development Specification", and that
> document is not in this repository.
>
> This matters for anyone auditing coverage. The identifiers cited throughout
> the runbooks and `spec-coverage.md` — `P0-CRM-07`, `CICD-001`, `AUTH-006`,
> `§16.1`, `§17.2` and the rest — do not resolve to anything here: grepping
> this file for any of them returns nothing. They were carried over from the
> specification proper. Until that document is added, "spec coverage" cannot be
> checked by a reader of this repository alone, and a claim that some
> requirement is met has to be read as a claim about intent rather than one
> that anybody can verify.
>
> This file remains the working statement of the goal, which is a genuinely
> useful thing to have versioned. It is simply not the numbered specification
> its citations imply.

**Goal: Complete QBBE Hub to Production-Ready, Deployment-Perfect State**

Your objective is to take the existing `Chxmdi/QBBE-HUB` repository and finish it until it fully satisfies the **QBBE Hub Master Product, UI/UX & Development Specification** with no meaningful gaps, no placeholder functionality, no fake integrations, no broken flows, no inaccessible states, and no unfinished production requirements.

Treat the **QBBE Master Spec as the single source of truth**. First perform a full requirement-by-requirement audit of the repository against the Master Spec. For every requirement, classify it as:

* `✅ Complete`
* `🟡 Partial`
* `❌ Missing`

Then implement every partial or missing requirement until the entire required scope is complete.

The finished application must be a **fully functional, production-grade internal operating system for QBBE**, covering project management, communication, Slack-style channels, announcements, task management, meetings, events, calendar, master schedule, unified inbox, CRM, people and teams, volunteer integration, documents, reporting, notifications, automation, search, administration, permissions, and all required external integrations.

Do not treat the project as finished simply because all pages exist. A feature is only complete if the UI, backend logic, database model, authorization, validation, realtime behavior where applicable, error handling, empty/loading states, responsive behavior, accessibility, testing, and production behavior are all implemented.

### 1. Complete all product functionality

Ensure every major product area from the Master Spec is complete:

* Operations Dashboard
* My Work
* Task list and Kanban board
* Programs
* Projects and project command centres
* Project health, milestones, updates, blockers and closure workflows
* Slack-style public/private channels
* Threads
* Reactions
* Mentions
* Direct messages
* Group messages
* Saved messages
* Pinned resources
* Message-to-task conversion
* Message-to-agenda conversion
* Message-to-decision conversion
* Announcement-only communication
* Mandatory announcements
* Announcement acknowledgements and progress tracking
* Meetings and agenda management
* Meeting notes
* Decisions
* Action items converted to tasks
* Events
* Event responsibilities and assignments
* Calendar
* Master Schedule
* People directory
* Teams and groups
* CRM organizations and contacts
* Follow-ups
* Relationship history
* Documents and resources
* Reports
* Notifications
* Global search
* Command palette
* Quick Create
* Admin controls
* Audit history
* Onboarding
* User preferences
* Light and dark themes
* Responsive/mobile UX

### 2. Finish every real external integration

Replace any placeholder or “not connected” implementation with production-ready integrations where required by the Master Spec.

Complete:

* Gmail OAuth
* Gmail inbox synchronization
* Gmail message/thread retrieval
* Gmail send/reply functionality where specified
* Gmail push/watch renewal and reconciliation
* Google Calendar synchronization
* Google Calendar event linking and updates
* Google Drive integration
* QBBE Volunteer Management System integration
* Transactional email delivery
* Email notification delivery
* Digest emails

OAuth tokens and credentials must be handled securely and never exposed to the browser unnecessarily.

Integration failures must produce clear states such as:

* connected
* disconnected
* degraded
* authentication expired
* synchronization delayed
* configuration required

Include retry, reconciliation and administrative recovery mechanisms.

Do not present an integration as complete if the UI only contains a connection card.

### 3. Build production-grade background jobs and automation

Implement the background processing infrastructure required for:

* scheduled announcements
* notification emails
* digests
* reminder delivery
* Gmail synchronization
* Gmail watch renewal
* calendar synchronization
* integration reconciliation
* volunteer-system synchronization
* delayed jobs
* scheduled workflows

Implement the workflow automation system defined by the Master Spec.

The automation model should support:

**Trigger → Conditions → Actions**

Examples:

* task becomes overdue → notify assignee
* project becomes at risk → notify project owner
* announcement remains unacknowledged → remind user
* meeting completes → post summary into project channel
* new volunteer assignment → notify responsible team
* CRM follow-up becomes due → notify owner

Automation execution must be:

* durable
* retryable
* idempotent
* auditable
* observable

### 4. Complete People and Teams

Expand People beyond a simple user directory.

Implement:

* user profiles
* departments/teams
* reusable groups
* team membership
* team ownership
* team-based assignment
* team mentions
* team channel membership
* team filtering
* workload visibility
* role and status visibility

Team membership should integrate naturally with permissions, channels, projects and notifications.

### 5. Complete notification architecture

Finish notifications as a complete product system.

Support:

* in-app notifications
* unread indicators
* mentions
* assignments
* replies
* announcement alerts
* due-date alerts
* approvals
* system alerts
* email alerts
* digests
* quiet hours
* channel mute preferences
* notification categories
* notification preferences
* deduplication

Users must have meaningful control over notification delivery without accidentally suppressing mandatory critical organizational communication.

### 6. Complete reporting

Reporting must be suitable for executive and operational use.

Include:

* versioned snapshots
* frozen historical data
* approval workflow
* report status
* audit trail
* CSV export
* first-class PDF generation
* clean print/export layout
* appropriate charts
* executive summaries
* program/project metrics

Do not rely solely on browser “Print → Save as PDF” for the final production implementation if the Master Spec requires generated exports.

### 7. Finish Admin and Settings

Admin must operate as a true control centre.

Complete:

* users
* invitations
* roles
* activation/deactivation
* teams
* channel governance
* integrations
* Connect/Disconnect/Reauthenticate flows
* integration health
* automation rules
* notification defaults
* organization settings
* templates
* audit logs
* security controls
* workspace defaults

Administrative actions must be protected both in the UI and at the database/API authorization layer.

### 8. Complete Quick Create

Quick Create should allow creation of all appropriate entities permitted by the user’s role, including:

* task
* project
* program
* meeting
* event
* channel
* announcement
* CRM contact
* CRM organization
* CRM follow-up

The menu must dynamically respect permissions.

### 9. Achieve the final Visual Excellence standard

Do not simply make the existing interface functional.

Apply the entire UI Upgrade and Visual Excellence direction.

The final application should feel like a premium modern workspace inspired by the quality level of Linear, Notion, Slack, Stripe and Apple, while remaining uniquely QBBE.

Prioritize:

* strong visual hierarchy
* whitespace
* editorial layouts
* restrained use of cards
* premium typography
* sophisticated QBBE branding
* polished sidebar
* contextual actions
* beautiful drawers
* refined tables
* meaningful charts
* excellent empty states
* skeleton loading
* clear error states
* subtle motion
* smooth transitions
* excellent dark mode
* responsive layouts
* mobile-specific navigation

Avoid:

* card-on-card layouts
* excessive gradients
* unnecessary glassmorphism
* rainbow dashboards
* oversized badges
* heavy shadows
* decorative animation
* giant modals
* generic admin-template appearance

Every major screen should feel intentionally designed rather than automatically generated.

### 10. Maintain the required code architecture

Keep the repository feature-first and easy to understand.

Major product functionality must remain organized under:

`src/features/<feature>`

Routes should remain thin.

Reusable visual primitives belong under:

`src/components/ui`

Shared shell components belong under:

`src/components/layout`

QBBE design tokens belong under:

`src/design-system`

Supabase schema belongs under:

`supabase/migrations`

Avoid giant files. Split large files into focused components, hooks, services and schemas.

Do not duplicate business logic across pages.

### 11. Production security must be complete

Perform a full security review.

Requirements include:

* Supabase RLS on every user-facing table
* deny-by-default policies
* server-side validation
* secure OAuth handling
* no service-role keys exposed to clients
* secure file access
* signed private URLs
* input sanitization
* rate limiting where required
* authorization tests
* no private-channel information leakage
* secure invitation handling
* secure account bootstrap
* audit logging for sensitive operations
* protected admin actions

Test attempts to bypass the UI and access unauthorized records directly.

### 12. Complete production observability

Add production-grade visibility into application health.

Include:

* structured application logs
* client error monitoring
* server error monitoring
* background-job monitoring
* integration health
* synchronization failures
* database failures
* slow-query visibility
* deployment health
* alerting for critical failures

Errors must be actionable rather than silently swallowed.

### 13. Complete automated testing

The project cannot be considered finished without strong automated coverage.

Maintain and expand:

* unit tests
* integration tests
* Playwright E2E tests
* accessibility tests
* responsive tests
* role/permission tests
* RLS negative tests
* realtime multi-user tests
* integration tests
* automation tests
* report generation tests

Test at minimum:

* Primary Owner
* Workspace Admin
* Staff
* Volunteer
* Guest/read-only user

Test both permitted and forbidden actions.

### 14. Performance requirements

Audit and optimize:

* page load
* query count
* database indexes
* realtime subscriptions
* bundle size
* client/server component boundaries
* rendering behavior
* image delivery
* pagination
* large lists
* large message histories
* large task boards

The application must remain responsive with realistic organizational data rather than only small seed datasets.

### 15. Complete accessibility

Meet WCAG 2.2 AA.

Validate:

* contrast
* keyboard navigation
* visible focus
* semantic structure
* screen-reader labeling
* modals
* drawers
* dropdown menus
* tables
* forms
* Kanban alternatives
* charts
* reduced motion
* 200% zoom

Accessibility is part of completion, not a follow-up task.

### 16. Fix repository and CI/CD structure

Establish a proper production branch strategy.

Create/use:

`main`

as the protected production branch.

Configure CI so every pull request and production merge runs:

* install from lockfile
* lint
* TypeScript checking
* unit tests
* integration tests where applicable
* accessibility tests
* production build
* dependency/security checks

Production deployments must only occur after required checks pass.

Use preview deployments for pull requests.

### 17. Deployment readiness

Prepare:

* production Supabase
* production Vercel
* QBBE-owned accounts
* domain/DNS
* environment variables
* OAuth credentials
* secure secrets
* backups
* recovery procedures
* migration strategy
* rollback strategy
* monitoring
* production email sender

Perform an actual staging deployment and complete a full rehearsal of the production deployment process.

### 18. Production data and demo data

Never leave hard-coded fake operational data in the production product.

Seed data may exist only in development/testing environments.

Production must start clean and be populated through real product flows.

Every button displayed to users must either work or be intentionally disabled with a clear explanation.

No misleading “coming soon” experiences should masquerade as complete features.

### 19. Documentation

Keep documentation synchronized with the actual implementation.

Include:

* Master Spec
* README
* architecture documentation
* ADRs
* database documentation
* integration setup
* deployment runbook
* backup/recovery runbook
* administrator guide
* developer setup
* environment variables
* troubleshooting

Add the Master Spec into the repository itself so future developers and AI coding agents always have access to the same source of truth.

---

# Definition of Complete

Do **not** declare the project complete until all of the following are true:

1. Every required Master Spec requirement is marked `✅ Complete`.
2. No P0 requirement remains partial or missing.
3. All required external integrations function with real accounts.
4. Background jobs and automation work reliably.
5. All major workflows work end-to-end.
6. Permission boundaries have been tested against unauthorized access.
7. Realtime communication works across multiple simultaneous users.
8. Desktop, tablet and mobile layouts have been QA tested.
9. Light and dark themes are visually complete.
10. WCAG 2.2 AA requirements pass.
11. Lint passes.
12. TypeScript checking passes with no errors.
13. Unit tests pass.
14. Integration tests pass.
15. E2E tests pass.
16. Accessibility tests pass.
17. Production build passes.
18. Database security checks pass.
19. No secrets exist in the repository.
20. No production-breaking console errors exist.
21. No dead navigation links exist.
22. No required buttons are nonfunctional.
23. No hard-coded demo records appear in production.
24. Monitoring and logging are active.
25. Backups and recovery have been verified.
26. Production deployment has been rehearsed successfully.
27. A final staging environment has been tested by realistic user roles.
28. The app has passed a final visual-quality audit against the QBBE UI Excellence specification.
29. Documentation matches the deployed implementation.
30. The production version can be deployed confidently without requiring immediate engineering fixes.

---

# Final delivery

When implementation is complete, produce a **Final Deployment Readiness Report** containing:

* Master Spec compliance percentage
* requirement-by-requirement completion matrix
* features implemented
* integrations verified
* automated test results
* accessibility results
* security results
* performance results
* database/RLS results
* deployment configuration
* monitoring configuration
* backup/recovery status
* remaining known issues
* deployment instructions
* rollback instructions

The final report must explicitly state either:

**`DEPLOYMENT READY`**

or:

**`NOT DEPLOYMENT READY`**

Never mark the project `DEPLOYMENT READY` while a required Master Spec feature, production dependency, security requirement, integration, automated test, or critical user flow remains incomplete.

The target is not “feature-complete enough.”
The target is a **cohesive, polished, secure, tested, observable, maintainable, production-ready QBBE Hub that can become the organization's real internal operating system immediately after deployment.**

That gives the coding agent a much stronger finish line than simply saying **“implement the Master Spec.”** It defines exactly what must be true before the project can legitimately be called complete and ready to deploy.

