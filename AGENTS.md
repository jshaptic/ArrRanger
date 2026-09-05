# AGENTS.md

## Critical rules

- **NEVER mutate an *Arr instance outside the queue.** Every change is staged as an op and
  runs only from Apply All. No direct writes from a route handler or a store.
- **NEVER add an instance switcher.** Every view loads every enabled instance in parallel.
- **NEVER render an unreachable instance as a configuration gap.** Unknown is not
  "missing": batch actions skip it, deletes need `force`, and the count is stated.
- **NEVER translate paths.** ArrRanger and the *Arr apps must see identical container
  paths; comparison is literal. A mismatch is reported, never bridged.
- **ALWAYS `PUT` a merged resource** - fetch raw, merge changed keys, PUT (`mergeForPut`).
  A partial body silently wipes omitted fields.
- **ALWAYS run `npm run typecheck` and `npm test`** before calling work done.

## Project context

TypeScript monorepo, npm workspaces, Node >= 22. `packages/shared` (types, queue contract,
`expandBraces`) → `apps/server` (Fastify + better-sqlite3 + migrations) → `apps/web`
(Vue 3 + Pinia + Vite). Shared builds first.

```bash
npm install && npm run build   # shared must be built once first
npm run dev                    # shared watch + server :8585 + Vite :5173
npm run typecheck              # every workspace, no emit
npm test                       # server integration + web component/store tests
```

## Fleet views

Every view loads every enabled instance in parallel. For tags and import lists, instances
*are* the X axis; `/paths` keeps the fleet-wide load but drops the axis, since one folder
belongs to one instance. Storage is not a separate view - changing a folder on disk and
changing which instances root at it are one job, so they are one table.

### Visual language

In the matrices - tags and import lists - these five cell states are the only cues that
carry meaning. Do not invent a sixth.

| Cue | Meaning |
|---|---|
| solid green cell + count | present, with how many media items carry it |
| dashed empty cell | missing on that instance (click to stage it there) |
| amber | drift: partial parity, an inaccessible mount, or a setting that disagrees |
| violet ring + glyph | a staged operation is pending for this cell |
| red `?` | that instance did not answer - unknown, deliberately *not* "missing" |

The last is enforced in `buildTagRows` / `buildRootFolderRows` (`cell.known`) and covered
by tests. The folder view has no cells to colour, so an instance that did not answer is
absent from every row's owners and the view says so once above the table, not per row.

## The folder view (`/paths`)

- **Rows are folders; instances are chips, not the axis.** The one place the fleet column
  layout is deliberately dropped.
- **Root folders are leaves.** Never `readdir` below one - the library lives there, and
  skipping it cut a 79-root-folder fleet's first paint from 2.2s to under a second.
- **No parity or drift reporting here.** Each instance rooting at its own subfolder is a
  normal layout, not drift; comparison is what the matrices are for.
- **Root folders outside `FS_ROOTS`, or absent from disk, are rows** - marked
  `not mounted here` and struck through respectively, at any depth.
- **`missing` means an instance holds a file for this path and the disk does not.** A
  monitored-but-not-downloaded film's path does not exist yet and is not a row.
- **Depth is answered by `PathIndexService`**, an ancestor closure over every media path,
  making "does any instance track anything at or under this" O(1) at any depth. That is
  why the join is server-side - the browser would need the fleet's whole library.

### Owner chips (`use`)

Precedence order. An instance using the folder in none of these ways is **absent**:

| Use | Meaning |
|---|---|
| `rootFolder` | a root folder at exactly this path |
| `tracked` | a media item at exactly this path |
| `containsRoot` | one or more of its root folders live **under** here |
| `ancestor` | media lives *under* here |
| `importList` | a list fills this folder, and the instance neither roots nor tracks here |

Use is structural, not a consequence of downloading - an empty, freshly configured `tv/`
still makes `/data/media` Sonarr's folder. The chip carries one count (that instance's
share, rendered even when `0`); the rest belongs on the owner card. Never collapse
`tracked` and `on disk` into one number; keep both free-space readings (this container's
`statfs` and what *Arr reports), since disagreement is the mapping diagnosis.

### Monitoring and free space

Row badges are computed **server-side** so the vocabulary cannot drift: `not a root
folder`, `untracked`, `unmanaged`, `missing`, `not mounted here`, `empty`, `symlink`,
`no access`, `read-only`. They render beside the name at the right of the Path column,
then anything staged, then the glyph. There is no State column.

| Severity | Source | Rendered |
|---|---|---|
| `error` | `not mounted here`, `missing`, `no access` | red `✕` |
| `warn` | `not a root folder`, `unmanaged`, `read-only`, low free space, a root folder its own instance calls inaccessible | amber `⚠` |
| `info` | `untracked`, `empty`, `symlink` | nothing |
| `ok` | none of the above | nothing |

`untracked` stays `info` on purpose - it fires on every non-media folder, so promoting it
would paint a healthy library amber. A collapsed row shows a dimmed `⚠` for worse below.

Free space is per filesystem, never per instance: resolved by device id, one `statfs` per
distinct filesystem per request, seeded from `FS_ROOTS`. `⚠ low` only ever lands on a
**mount or a root folder**. Never restore a per-instance total - it double-counts a disk.

### Filters

- **Filtering is server-side** (`?instance=`, `?path=`, `?q=`, repeatable). A client-side
  filter would leave the summary row describing rows it had just removed.
- **Apply `only`, `q` and `limit` before any per-child `stat`.** A level of 64 entries or
  fewer is served whole and fully probed; a bigger one defaults to problems-only. `empty`
  and `no access` need a read per child, so on a big level they report `null`, not zero.
- **Brace expansion lives in `@arrranger/shared` (`expandBraces`)** and runs on both sides:
  the server filters the levels it returns, the browser needs the identical verdict.
- Folders on the way to a match stay visible and **dimmed**; mounts and anything with a
  root folder below are never filtered away. In `exclude` mode nothing is protected.
- `q` implies `only=all`; excluding does not. An unparseable filter is never sent, and the
  API rejects it with 400 rather than returning an unfiltered tree.
- **No "Modified" sort.** A level comes from one `readdir`, which carries no mtime, so
  ordering by it would mean statting every child before paging.

### Actions

- **Never infer the instance from the fleet bar** - the bar is a filter only. Remove and
  realign take their instances from the folder's own owners; an action that *adds* a root
  folder must ask. Every dialog names each instance before anything is staged.
- **Removing a root folder is a button on the owner card**, never a bare click on a chip.
- **Creating folders is a toolbar action, not a row action** (`New folder(s)…`), taking the
  syntax `mkdir -p` takes, expanded by the same `expandBraces`, previewed and preflighted.
- **Renaming is one action, never a `rename` beside an `align`.** Both asked for the same
  new name and differed only in whether the *Arr half ran, so the choice belongs inside the
  dialog: the folder's root-folder owners are checkboxes there, and the disk step is always
  the head of the chain. The row labels it `rename & align` when there is something to
  carry.
- **Do not offer an align chain for renaming an individual media folder.**
  `media.moveRootFolder` only sets `rootFolderPath` and `media.refresh` re-reads the stored
  path, so nothing can make *Arr adopt a renamed media folder. A media folder has no
  root-folder owners, so the rename dialog offers it nothing to follow.

## The queue engine

- **Two op families.** `ArrOp` always names an instance, `FsOp` never does - a DB `CHECK`
  on `(kind, instance_id)` enforces it. Adding to `QueueOpPayloads` must break compilation
  in both handler maps, the summary renderer and the target resolver.
- **`onError` defaults to `pause`** - the run stops, the failed item keeps its code and
  status, later items stay `pending`. `continue` records and moves on; `abort` cancels the
  rest. A paused run blocks new runs, so two runs never touch one instance at once.
- **`dependsOnId` may cross families.** The executor passes the dependency's stored result
  into the handler; if the dependency fails the dependent is `skipped`, never run against a
  wrong id. This is what makes mixed disk + *Arr recipes safe.
- **Preflight runs at stage time and again immediately before execution**, so a stale
  operation fails with `fs_precondition_failed` instead of acting on an unreviewed disk.
- **Restart recovery**: runs still marked `running` at boot are parked `paused` and the
  in-flight item is `failed` with code `interrupted` - the decision goes back to the user.

## Storage access

**ArrRanger must see media at exactly the same container path the *Arr apps use.** There is
deliberately no translation layer - a wrong mapping that silently "works" is more dangerous
than one that refuses. One binding for the whole tree, so a rename stays atomic.

| | |
|---|---|
| Scope | Directories only. No file-level create, rename or delete. |
| Traversal | Resolved against the configured roots; the parent chain is realpath'd so a symlink cannot escape. A symlink *leaf* is left unresolved. |
| Symlinks | Shown, never followed, never mutated. |
| Deleting | Hard delete. Non-empty needs `recursive`; a folder an instance still tracks - or one that cannot be checked - needs `force`. A storage root or mount point is refused. |
| Cross-filesystem moves | **Refused.** Preflight compares device ids and reports how much would have to be copied. |

`/config` is chowned to `PUID:PGID`. **Media roots are never chowned.**

## *Arr API notes

1. **Parse narrow, keep raw.** Zod validates only the fields that are rendered; the
   untouched response body rides along as `raw` (`ArrResource<TView>`). Never widen a
   schema to "be complete".
2. **`PUT` replaces the resource.** Always fetch raw → merge the changed keys → PUT the
   merged object back (`mergeForPut`).

- **There is no `PUT /api/v3/rootfolder`** - changing one is create → move with the editor
  → delete, which is exactly the three steps the queue models.
- **`/movie` and `/series` do not paginate** - fetched once into `resource_snapshots`, then
  paged server-side, with `excludeLocalCovers` (Radarr) / `includeSeasonImages` (Sonarr).
- **Map errors to codes the UI can act on**, never raw statuses: `arr_unauthorized`,
  `arr_not_found`, `arr_validation_failed`, `arr_timeout`, `arr_unreachable`,
  `arr_dns_failure`, `arr_tls_untrusted`, `arr_unexpected_response`, `arr_conflict`.

## Data and security

- API keys are AES-256-GCM encrypted before hitting SQLite, keyed from `ARRRANGER_SECRET`
  or `/config/secret.key`. **The key is never returned by the HTTP API** - keep the
  `Instance` vs `InstanceWithKey` split in `packages/shared/src/instance.ts`.
- ArrRanger has no authentication of its own; do not bolt one on ad hoc.

## Toolchain pitfalls

- **TypeScript is pinned `~5.9`** - `vue-tsc` 3.x still resolves `typescript/lib/tsc`.
- **All build tooling lives in the root `package.json`** - `--omit=dev` skips the root's
  devDependencies but not a workspace's, so those would ship in the runtime image.
- **Migrations toggle `PRAGMA foreign_keys` outside the transaction** and run
  `foreign_key_check` after; it is a no-op inside one, and a rebuild with foreign keys
  enforced cascades away the audit trail.
- **Web tests are headless** (Vitest + happy-dom, API mocked). Styling is not asserted.
- **`better-sqlite3` needs `python3 make g++` in the builder stage** for `node-gyp rebuild`.
