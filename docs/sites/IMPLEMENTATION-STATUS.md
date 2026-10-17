# Sites compatibility implementation — 14 October 2026

## Implemented
Isolated branch `sites/hosting-compatibility` from `6a55e996d18190247662c4d6b68d946c3fe7b677`.
Added the supported Sites/Vinext runtime scaffold, Worker entrypoint, Vite integration, install helpers and optional hosting manifest. No Site ID or credentials are stored. Existing product source and Next.js build/start/dev scripts remain unchanged.

Run `npm run build:sites` to produce the Sites Worker output. `npm run build` still produces the original Next.js deployment. Do not use the generic Sites build helper's default `build` script for this dual-target checkout without explicitly arranging the Sites build command. For Sites packaging, pass `commands: [["npm", "run", "build:sites"]]` to the source workflow; omit that command only if the exact unchanged source was already built. No archive has yet been published.

Vinext requires ESM package configuration (`type: module`). The repository's existing unit suite passed with this change. Added generated-output exclusions to TypeScript, a Worker-specific type import, and matched the React server-dom package to resolved React 19.2.8.

## Evidence
- Dependency install: Sites helper completed integrity-pinned Vinext download and `npm ci` successfully.
- Initial Sites build: all five build stages completed; 185 page files / 44 handler files inventoried; route table generated. OCR/PDF assets copied.
- Unit suite: 279 test files, 2,859 tests passed. Executed after initial scaffold; subsequent changes only align React server-dom dependency, add Worker type import and exclude generated TypeScript output. These tests are not live integration tests.
- Type check: `NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck` passed after the Worker type import. Default 2 GB run exhausted its heap, so CI memory sizing must be reviewed.
- Final Sites build after React package alignment and Worker type fix passed again.
- Diff whitespace check passed.
- Build output measured initially at approximately 23 MB client and 15 MB server uncompressed. These sizes do not establish runtime memory use or deployment quota compliance.

## Remaining gates
No browser QA, hosted login, database mutation, RLS exercise, scanner operation, service callback or deployment has been verified. Build succeeds despite incompatible TCP paths remaining in source; compilation is not proof they can execute on Sites. Client chunk-size warnings need performance measurement, not suppression.

The connected Supabase account does not list a QBBE-HUB staging project. Obtain access to the correct staging project/configuration before connecting the app. Do not substitute another project's database. Scanner hosting and intended audience/public-page behavior remain unresolved.

No Site registration, secrets change, database change, production deployment, scheduler reroute or external provider change was performed. Original production release process is retained. Keep this PR draft until runtime and release gates pass.
