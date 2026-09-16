# QBBE Hub brand refresh

This branch adopts the visual direction approved for the QBBE Hub demo while preserving the existing application architecture and backend behavior.

## Brand source

The approved bilingual Quebec Board of Black Educators mark is the visual reference for the application shell.

- Primary QBBE blue: `#2A3C90`
- Strong blue: `#1D2E70`
- Warm gold accent: `#E8B36D`
- White remains the logo/primary contrast color.

The design system adds supporting tints for accessible operational UI, but feature components should consume semantic tokens instead of hard-coded brand colors.

## Typography

Body/UI text stays a highly legible operational sans stack. Major page and section headings use an editorial serif display stack with restrained blue gradients and gold rules so the interface feels more distinctive without sacrificing dense-work readability.

## Backend contract

This refresh does not introduce demo/localStorage behavior into the production application. Existing Supabase queries, Auth, Postgres RLS, notifications, realtime behavior, commands, and route semantics remain authoritative.

## Scope of the first slice

- design tokens and dark theme
- bilingual QBBE identity in the sidebar/auth shell
- blue/gold permission-aware navigation
- refreshed topbar/search/create/notification treatments
- global heading/card treatments that propagate to Dashboard, My Work, Board, Projects, and other existing backend-connected screens

Further feature-level layout refinement should continue incrementally under Linear acceptance criteria rather than creating a parallel frontend.