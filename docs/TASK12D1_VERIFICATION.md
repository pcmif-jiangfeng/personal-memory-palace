# Task 12D1 — Museum Onboarding

## Scope

- Verified Users without an Own Museum enter `/account/onboarding` after login.
- `POST /api/museums` requires the verified User session and a same-origin request.
- The owner comes only from the session, never from the request body.
- Name and slug are required; description and cover can be skipped.
- Creation enters `/account`, which displays only that User's Own Museum.
- Existing Museum owners bypass onboarding. No Switcher, Invite, Collaborator, profile editing or legacy-content write permissions were added.

## Verification (2026-09-26)

- `pnpm check`: typecheck, lint, all 154 tests and formatting passed.
- `pnpm build`: production build passed.
- Isolated SQLite/HTTP smoke: unauthenticated 401, foreign-origin 403, invalid fields 400, successful creation 201, repeat owner/slug conflicts 409; account/onboarding redirects and two-user separation passed.
- Isolated Chrome: login → onboarding → create without optional fields → Own Museum → reload passed; no console errors or page errors captured.
- Browser viewport widths 320, 768, 1024 and 1440: no horizontal overflow. Onboarding screenshot visually reviewed.
- Smoke users, database, server and temporary scripts were removed; no production data was used.

## Review

Ownership is session-derived, SQL is parameterized, output is React-escaped, unique database indexes prevent duplicate Museums, and conflict responses do not expose database details. Existing authentication and legacy Owner routes are unchanged. Museum content editing and cover selection remain outside this stage.
