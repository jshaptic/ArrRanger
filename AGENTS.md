# AGENTS.md

Keep this file under 200 lines. Tighten existing rules rather than adding sections.

## Critical rules

- **NEVER mutate an \*Arr instance outside the queue.** Stage every change as an op; it
  runs only from Apply All. No direct writes from a route handler or a store.
- **NEVER render an unreachable instance as a configuration gap.** Unknown is not
  "missing": batch actions skip it, deletes need `force`, and the count is stated.
- **NEVER translate paths.** ArrRanger and the *Arr apps must see identical container
  paths; comparison is literal. A mismatch is reported, never bridged.
- **ALWAYS `PUT` a merged resource** - fetch raw, merge changed keys, PUT (`mergeForPut`).
  A partial body silently wipes omitted fields.
- **ALWAYS reuse `components/base`.** Invent a new component only when nothing there fits.
- **NEVER import an icon library outside `components/base/icons/glyphs.ts`.** That module
  is the app's only contact with `@remixicon/vue`; every other file asks for a meaning
  (`IconWarning`) and optionally a weight (`variant="solid"`), never a drawing.
  `icons.test.ts` fails the build if anything else names it.
- **NEVER add a `<style>` block.** Components are utility-classes-only; `icons.test.ts`
  pins that at zero.
- **NEVER hand-roll a checkbox.** `BaseCheckbox` is the only one, and it keeps a real
  `<input type="checkbox">` under a drawn box.
- **ALWAYS run `npm run typecheck` and `npm test`** before calling work done.

## Project context

TypeScript monorepo, npm workspaces, Node >= 22. `packages/shared` (types, queue contract,
`expandBraces`) → `apps/server` (Fastify + better-sqlite3 + migrations) → `apps/web`
(Vue 3 + Pinia + Vite). Shared builds first.

```bash
npm install && npm run build # shared must be built once first
npm run dev # shared watch + server :8585 + Vite :5173
npm run typecheck # every workspace, no emit
npm test # server integration + web component/store tests
```

## Visual language

In the matrices - tags and import lists - these five cell states are the only cues that
carry meaning. Do not invent a sixth.

| Cue | Meaning |
|---|---|
| solid green cell + count | present, with how many media items carry it |
| dashed empty cell | missing on that instance (click to stage it there) |
| amber | drift: partial parity, an inaccessible mount, or a setting that disagrees |
| violet ring + glyph | a staged operation is pending for this cell |
| red unknown icon | that instance did not answer - unknown, deliberately *not* "missing" |

The last is enforced in `buildTagRows` / `buildRootFolderRows` (`cell.known`). The folder
view has no cells to colour: an unreachable instance is absent from every row's owners
and the view says so once above the table, not per row.

## The folder view (`/paths`)

- **Rows are folders; instances are chips, not the axis.** The one place the fleet column
  layout is dropped.
- **Root folders are leaves.** Never `readdir` below one - the library lives there.
- **No parity or drift reporting here.** Each instance rooting at its own subfolder is a
  normal layout; comparison is what the matrices are for.
- **Root folders outside `FS_ROOTS`, or absent from disk, are rows** - marked
  `not mounted here` and struck through respectively, at any depth.
- **`missing` means an instance holds a file for this path and the disk does not.** A
  monitored-but-not-downloaded film's path does not exist yet and is not a row.
- **Depth is answered by `PathIndexService`** (ancestor closure over every media path).
  The join is server-side so the browser never needs the fleet's whole library.

### Owner chips (`use`)

Precedence. An instance using the folder in none of these ways is **absent**:

| Use | Meaning |
|---|---|
| `rootFolder` | a root folder at exactly this path |
| `tracked` | a media item at exactly this path |
| `containsRoot` | one or more of its root folders live **under** here |
| `ancestor` | media lives *under* here |
| `importList` | a list fills this folder, and the instance neither roots nor tracks here |

Use is structural, not a consequence of downloading - an empty, freshly configured `tv/`
still makes `/data/media` Sonarr's folder. The chip carries one count (that instance's
share, even when `0`); the rest belongs on the owner card. Never collapse `tracked` and
`on disk` into one number; keep both free-space readings (this container's `statfs` and
what *Arr reports), since disagreement is the mapping diagnosis.

### Monitoring and free space

Row badges are computed **server-side** so the vocabulary cannot drift: `untracked`,
`unmanaged`, `missing`, `not mounted here`, `empty`, `symlink`, `no access`,
`read-only`. They render at the right of the Path column, after the row actions.
Staged work and the severity glyph stay beside the name. There is no State column.

| Severity | Source | Rendered |
|---|---|---|
| `error` | `not mounted here`, `missing`, `no access` | red error icon |
| `warn` | `unmanaged`, `read-only`, low free space, a root folder its own instance calls inaccessible | amber warning icon |
| `info` | `untracked`, `empty`, `symlink` | nothing |
| `ok` | none of the above | nothing |

`untracked` stays `info` - it fires on every non-media folder. A collapsed row shows a
dimmed warning for worse below. Free space is per filesystem, never per instance: one
`statfs` per device id per request, seeded from `FS_ROOTS`. A low-space warning only
ever lands on a **mount or a root folder**. Never restore a per-instance total.

### Filters

- **Filtering is server-side** (`?instance=`, `?path=`, `?q=`, repeatable). A client-side
  filter would leave the summary describing rows it had just removed.
- **Apply `only`, `q` and `limit` before any per-child `stat`.** A level of 64 or fewer is
  served whole and fully probed; a bigger one defaults to problems-only. `empty` and
  `no access` need a read per child, so on a big level they report `null`, not zero.
- **Brace expansion** (`expandBraces` in `@arrranger/shared`) runs on both sides so server
  and browser share the verdict.
- Folders on the way to a match stay visible and **dimmed**; mounts and anything with a
  root folder below are never filtered away. In `exclude` mode nothing is protected.
- `q` implies `only=all`; excluding does not. An unparseable filter is never sent; the
  API rejects it with 400 rather than returning an unfiltered tree.
- **No "Modified" sort.** A level comes from one `readdir`, which carries no mtime.

## The queue engine

- **Two op families.** `ArrOp` always names an instance, `FsOp` never does - a DB `CHECK`
  on `(kind, instance_id)` enforces it. Adding to `QueueOpPayloads` must break compilation
  in both handler maps, the summary renderer and the target resolver.
- **`onError` defaults to `pause`** - the run stops, the failed item keeps its code and
  status, later items stay `pending`. `continue` records and moves on; `abort` cancels the
  rest. A paused run blocks new runs, so two runs never touch one instance at once.
- **`dependsOnId` may cross families.** The executor passes the dependency's stored result
  into the handler; if the dependency fails the dependent is `skipped`, never run against
  a wrong id.
- **Preflight runs at stage time and again immediately before execution**, so a stale
  operation fails with `fs_precondition_failed` instead of acting on an unreviewed disk.
- **Restart recovery**: runs still marked `running` at boot are parked `paused` and the
  in-flight item is `failed` with code `interrupted`.

## Storage access

ArrRanger must see media at exactly the same container path the *Arr apps use. No
translation layer. One binding for the whole tree, so a rename stays atomic.

| | |
|---|---|
| Scope | Directories only. No file-level create, rename or delete. |
| Traversal | Resolved against the configured roots; the parent chain is realpath'd so a symlink cannot escape. A symlink *leaf* is left unresolved. |
| Symlinks | Shown, never followed, never mutated. |
| Deleting | Hard delete. Non-empty needs `recursive`; a folder an instance still tracks - or one that cannot be checked - needs `force`. A storage root or mount point is refused. |
| Cross-filesystem moves | **Refused.** Preflight compares device ids and reports how much would have to be copied. |

`/config` is chowned to `PUID:PGID`. **Media roots are never chowned.**

## *Arr API notes

- **Parse narrow, keep raw.** Zod validates only the fields that are rendered; the
  untouched body rides along as `raw` (`ArrResource<TView>`). Never widen a schema to
  "be complete".
- **`PUT` replaces the resource.** Fetch raw → merge changed keys → PUT (`mergeForPut`).
  There is no `PUT /api/v3/rootfolder` - changing one is create → move with the editor →
  delete, which is what the queue models.
- **`/movie` and `/series` do not paginate** - fetched once into `resource_snapshots`,
  then paged server-side, with `excludeLocalCovers` (Radarr) / `includeSeasonImages`
  (Sonarr).
- **Map errors to codes the UI can act on**, never raw statuses: `arr_unauthorized`,
  `arr_not_found`, `arr_validation_failed`, `arr_timeout`, `arr_unreachable`,
  `arr_dns_failure`, `arr_tls_untrusted`, `arr_unexpected_response`, `arr_conflict`.

## Data and security

- API keys are AES-256-GCM encrypted before hitting SQLite, keyed from `ARRRANGER_SECRET`
  or `/config/secret.key`. **The key is never returned by the HTTP API** - keep the
  `Instance` vs `InstanceWithKey` split in `packages/shared/src/instance.ts`.
- ArrRanger has no authentication of its own; do not bolt one on ad hoc.

## Toolchain pitfalls

- TypeScript is pinned `~5.9` (`vue-tsc` 3.x still resolves `typescript/lib/tsc`).
- All build tooling lives in the root `package.json` - `--omit=dev` skips the root's
  devDependencies but not a workspace's, so those would ship in the runtime image.
- Migrations toggle `PRAGMA foreign_keys` outside the transaction and run
  `foreign_key_check` after; it is a no-op inside one, and a rebuild with foreign keys
  enforced cascades away the audit trail.
- Web tests are headless (Vitest + happy-dom, API mocked). Styling is not asserted.
- `better-sqlite3` needs `python3 make g++` in the builder stage for `node-gyp rebuild`.
