# Navigation and task workflow candidate

This candidate reorganizes the existing consolidated navigation into work areas. All destinations retain their original role and feature predicates; the complete mapping is in [navigation-map.md](navigation-map.md). The legacy menu remains selected when `wos_home` is off.

Implemented:

- Six everyday work areas, relevant specialist areas, expandable local links and All tools. Channel and program shortcuts appear in their work context.
- Mobile tabs for Today, My Work, Messages and Calendar. Search retains every authorized destination.
- Shared task creation and drawer on lens My Work. In-place links preserve query filters; ordinary close preserves the list and scroll.
- Four initial task fields with optional details retained in the form. Duplicate submission guard and recoverable network errors.
- Global task creation follows the enabled task page. Common creation actions appear first; specialist actions remain available.
- Explicit Page creation with authorized visibility choices, defaulting to private when allowed.
- English and French labels. Collapsed mobile navigation entries are excluded from the focus trap.

Still required before acceptance:

- Browser checks for keyboard, mobile layouts, Back/refresh, same-page creation, failed saves and modal focus.
- Authenticated role and real-data tests. Unit tests do not establish database permissions or service availability.
- Feature parity before redirecting old My Work URLs. The classic screen still includes archived work, saved views and additional responsibilities, so it remains accessible.
- User pins, staff baseline measurements and pilot feedback.
- Remaining personal overview, meeting, Knowledge, reporting and specialist consolidation from later releases.

No routes or data have been deleted. No database migration is required. Rollback uses the previous compatible application artifact; changing the home navigation switch only reverses navigation presentation, not all task or page changes.

Verification commands:

```sh
npm test
NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck
npm run lint
NODE_OPTIONS=--max-old-space-size=6144 npm run build:sites
```

Run browser and authenticated workflow acceptance on a compatible candidate before publishing. Build and unit-test success alone do not establish release readiness.
