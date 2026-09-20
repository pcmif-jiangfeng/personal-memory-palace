# SQLite Row Boundary Inventory

## Scope

This inventory covers only the repositories named by Task A1 and only SQLite result casts of the form `as unknown as ...`.

Existing reusable primitive readers in `src/data/row-readers.ts`:

- `readString`
- `readNullableString`
- `readNumber`
- `readBooleanFlag`

No target row contains JSON. All proposed row readers should remain local to their repository and compose the existing primitive readers; this task does not recommend an ORM-like generic mapper.

## `src/data/memory-repository.ts`

15 target assertions. This repository needs the largest follow-up and should be handled alone in Task A2.

| Line | Query result | Field shape | Existing reader coverage | Recommended treatment |
| ---: | --- | --- | --- | --- |
| 91 | `StageRow[]` for active stages | strings; nullable `trashed_at`, `cover_key` | `readString`, `readNullableString` | Add local `readStageRow`; reuse it for all Stage queries. |
| 103 | stage memory counts | `stage_id: string`, `count: number` | `readString`, `readNumber` | Add local `readStageCountRow`. |
| 116 | stage preview keys | two strings | `readString` | Add local `readStagePreviewRow`. |
| 134 | active `MemorySummaryRow[]` | strings; nullable stage/trash/cover fields; numeric `image_count`; string enum `visibility` | primitive readers cover storage types | Add local `readMemorySummaryRow`; validate `visibility` locally as `private` or `shared`. |
| 143 | searched `MemorySummaryRow[]` | same as line 134 | same | Reuse `readMemorySummaryRow`. |
| 158 | random `MemorySummaryRow \| undefined` | same as line 134 | same | Map the optional `.get()` result through `readMemorySummaryRow` only when present. |
| 163 | trashed `MemorySummaryRow[]` | same as line 134 | same | Reuse `readMemorySummaryRow`. |
| 168 | trashed `StageRow[]` | same Stage shape as line 91 | same | Reuse `readStageRow`. |
| 182 | Memory by id | same Memory summary shape | same | Reuse `readMemorySummaryRow` for the optional row. |
| 191 | Stage by id | same Stage shape as line 91 | same | Reuse `readStageRow` for the optional row. |
| 205 | `MemoryImageRow[]` | strings; numeric `sort_order`; SQLite `is_cover` flag | includes `readBooleanFlag` | Add local `readMemoryImageRow`; represent `is_cover` as a validated boolean internally or validate the flag before mapping. |
| 221 | related Memory ids | one string | `readString` | Add a small local `readIdRow`, or map directly with `readString(row, "id")`. |
| 229 | related `MemorySummaryRow[]` | same as line 134 | same | Reuse `readMemorySummaryRow`. |
| 234 | `LaterNoteRow[]` | four strings | `readString` | Add local `readLaterNoteRow`. |
| 247 | Memories by Stage | same Memory summary shape | same | Reuse `readMemorySummaryRow`. |

Notes:

- `visibility` is not merely an arbitrary SQLite string. A local semantic check is required before returning the union type.
- `is_cover` is the only boolean flag in this file.
- There are no JSON fields.

## `src/data/memory-write-repository.ts`

1 target assertion.

| Line | Query result | Field shape | Existing reader coverage | Recommended treatment |
| ---: | --- | --- | --- | --- |
| 56 | `PhotoKeyRow[]` | `id` and `storage_key`, both strings | `readString` | Add local `readPhotoKeyRow` and map `.all(...photoIds)` through it. |

Notes:

- No nullable, boolean, or JSON fields are involved.
- The later relation-id query is currently untyped rather than double-cast, so it is outside Task A1's exact target. It may be evaluated during Task A3 without expanding scope beyond this repository.

## `src/data/memory-exhibit-repository.ts`

3 target assertions.

| Line | Query result | Field shape | Existing reader coverage | Recommended treatment |
| ---: | --- | --- | --- | --- |
| 67 | `PhotoKeyRow[]` | `id` and `storage_key`, both strings | `readString` | Add local `readPhotoKeyRow`. |
| 74 | current storage keys | one string | `readString` | Add local `readStorageKeyRow`, or map directly with `readString`. |
| 169 | current photo ids | one string | `readString` | Add/reuse a local `readIdRow`. |

Notes:

- No nullable, boolean, or JSON fields occur in the three double assertions.
- Adjacent direct casts for `value`, `is_cover`, fallback `id`, and `PhotoKeyRow` have the same runtime-boundary risk but are not `as unknown as` targets. Task A4 can assess them within the same repository; it should still avoid UI changes.

## `src/data/management-repository.ts`

2 target assertions.

| Line | Query result | Field shape | Existing reader coverage | Recommended treatment |
| ---: | --- | --- | --- | --- |
| 182 | photo ids before permanent Memory deletion | one string | `readString` | Add local `readIdRow` and map the result. |
| 203 | photo ids before permanent Stage deletion | one string | `readString` | Reuse the same local `readIdRow`. |

Notes:

- No nullable, boolean, or JSON fields occur in these double assertions.
- `queueUnreferencedPhotos` contains a separate direct cast with nullable `originalStorageKey`; it is outside the exact A1 search but should be considered in Task A5 using `readString` and `readNullableString`.

## Recommended execution order

1. Task A2: `memory-repository.ts` — 15 assertions and all complex shapes.
2. Task A3: `memory-write-repository.ts` — one two-string row.
3. Task A4: `memory-exhibit-repository.ts` — three simple rows, then assess adjacent direct casts without touching UI.
4. Task A5: `management-repository.ts` — two id rows, then assess the nullable deletion-job row.
5. Task A6: search only `src/data/` and classify any remaining `as unknown as` occurrences.

## Acceptance accounting

- Target assertions inventoried: **21**.
- Every target has an explicit reader recommendation.
- Existing primitive readers are sufficient for all SQLite primitives.
- One local semantic validator is likely needed for `MemorySummaryRow.visibility`.
- No JSON reader is needed.

## Phase A completion

Tasks A2–A5 removed all 21 inventoried SQLite result assertions.

The Task A6 search of `src/data/` found no remaining `as unknown as` occurrences:

- Reasonable to retain: **0**.
- Should be removed: **0**.
- Unrelated to SQLite rows: **0**.

The Row Boundary phase is complete. Direct assertions outside the inventory's exact
`as unknown as` scope remain separate review candidates and were not expanded into
this closeout task.
