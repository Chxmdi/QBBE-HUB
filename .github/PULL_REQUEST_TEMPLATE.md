# Canonical GitHub Issue

Closes #<!-- required: the primary implementation Issue -->

## Parent Epic

#<!-- required Epic issue -->

## PRD / Acceptance IDs

<!-- List every requirement ID this PR implements or verifies. Use N/A only for non-product maintenance. -->

## Objective

<!-- What outcome does this PR achieve? -->

## Scope

### Included
- 

### Not included
- 

## Dependencies

- Blocked by: #
- Blocks: #
- External dependencies: <!-- credentials/provider/manual approval, or None -->

## Implementation

<!-- Summarize the architecture, modules, migrations, APIs, UI, jobs, configuration and error handling changed. -->

## Security / Data Impact

- Authorization/RLS impact:
- Data/migration impact:
- Secrets/config impact:
- Privacy/audit impact:

## Verification

- [ ] Locked install succeeds
- [ ] Lint passes
- [ ] Typecheck passes
- [ ] Relevant unit/integration tests pass
- [ ] Relevant database/RLS allow + deny tests pass
- [ ] Production build passes
- [ ] Relevant browser/E2E checks pass
- [ ] Accessibility/keyboard checks pass when UI changes
- [ ] Security/dependency checks pass or findings are dispositioned
- [ ] Failure/edge cases are tested
- [ ] Acceptance evidence is recorded against the exact commit/environment

### Commands / artifacts

<!-- Exact commands, CI run, environment and artifact links. Do not invent results. -->

## Acceptance Criteria

<!-- Copy or reference the objectively verifiable criteria from the canonical Issue. -->

## Definition of Done

- [ ] Requirements are satisfied
- [ ] Implementation is complete
- [ ] Required tests exist and pass
- [ ] Error/failure cases are handled
- [ ] Security implications are verified
- [ ] Documentation is current
- [ ] Canonical Issue can be closed without relying on unverified claims

## Release Impact

- Environment(s): local / CI / staging / production
- Deployment required: yes / no
- Migration required: yes / no
- Rollback notes:

> A merged PR is implementation evidence. It does not by itself prove the related Epic, PRD row, staging gate, or production gate is complete.