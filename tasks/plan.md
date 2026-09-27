# Implementation Plan: Code quality audit remediation

## Overview

Apply the audit in small, verifiable slices. Keep the Next.js/SQLite monolith and avoid new dependencies.

## Decisions

- Domain errors own predictable business failures; HTTP maps them once.
- Mutation routes enforce same-origin requests before owner authorization.
- File operations remain a database-backed retry queue; recovery is explicit and testable.
- Photo catalogs return bounded pages rather than full client-side catalogs.

## Task List

### Phase 1: Boundaries and security

- [x] Task 1: Introduce typed domain errors and remove data-to-HTTP imports.
- [x] Task 2: Add same-origin protection and route-level mutation tests.
- [x] Task 3: Add share-token rotation and document proxy/share-link constraints.

### Checkpoint: Phase 1

- [x] Typecheck, lint, tests, and build pass.

### Phase 2: Data lifecycle

- [x] Task 4: Recover pending photo deletions and report unresolved jobs.
- [x] Task 5: Make upload cleanup recoverable and make backup quiescence explicit.

### Checkpoint: Phase 2

- [x] Failure-injection tests cover retry and recovery paths.

### Phase 3: Read-model limits

- [x] Task 6: Add server-side photo catalog pagination and migrate workspace use.
- [x] Task 7: Make related-memory edges canonical and test both edit directions.

### Checkpoint: Complete

- [x] Full checks pass and audit findings are re-reviewed.

## Risks

- Database schema changes require idempotent migration coverage.
- Route tests must not bypass cookie and origin boundaries.
- Existing local runtime files remain outside source-control changes.
