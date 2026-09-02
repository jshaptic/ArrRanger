# ArrRanger

A mass-editing and staging tool for Radarr and Sonarr, in the spirit of a partition
manager: you make all your edits against a snapshot, review them as a batch, and only
then commit them to the live instances.

Connect one or more Radarr/Sonarr instances, browse their tags, root folders and
import lists, and stage changes - renames, merges, deletions, bulk root-folder moves.
Nothing is sent to an *Arr instance until you press **Apply All**, which executes the
queue sequentially with a progress bar and pauses on the first failure so you are never
left half-applied.

## Requirements

- Node.js >= 22 (developed on 24)
- npm 10+ (workspaces)
- Docker (for the deployment image)

## Development

```bash
npm install
npm run build          # shared must be built once before the watchers start
npm run dev            # shared tsc --watch + server on :8585 + Vite on :5173
```

Open http://localhost:5173 - Vite proxies `/api` to the Fastify process on :8585.
In development the SQLite database and the generated key file are written to
`./.config-dev/` (gitignored).

Useful scripts:

| Command | What it does |
|---|---|
| `npm run build` | Builds shared, then server (tsc), then web (vue-tsc + vite) |
| `npm run typecheck` | Type-checks every workspace without emitting |
| `npm start` | Runs the built server (serves the built SPA too) |
| `npm test` | Server integration suites + frontend component/store tests |
| `npm run clean` | Removes all `dist/` output |

## Docker

```bash
docker compose build
docker compose up -d
```

The image is a multi-stage build on `node:24-alpine`; the runtime stage contains only
the production dependency tree (~60 MB), the compiled server, the migrations and the
built SPA.

Deployment notes:

- **Volume**: everything stateful lives in `/config` - `arrranger.db` and, unless
  `ARRRANGER_SECRET` is set, a generated `secret.key` (mode 0600).
- **Unraid**: map `/config` to a path on the cache disk (`/mnt/cache/appdata/arrranger`)
  rather than a `/mnt/user/...` share. SQLite in WAL mode on the FUSE share layer is a
  known source of "database is locked" errors - the same advice the *Arr apps give.
- **PUID/PGID**: the entrypoint chowns `/config` and drops to those ids via `su-exec`
  (defaults 99:100, the Unraid `nobody:users` pair).
- **Healthcheck**: `GET /api/health` on the container port.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8585` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `CONFIG_DIR` | `/config` | Database + key file location |
| `ARRRANGER_SECRET` | *(generated)* | Key material for encrypting stored *Arr API keys |
| `LOG_LEVEL` | `info` | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` |
| `FS_ROOTS` | *(empty)* | Storage roots ArrRanger may inspect and modify, colon-separated. Empty disables all filesystem operations. |
| `TZ` | `Etc/UTC` | Container timezone |
| `PUID` / `PGID` | `99` / `100` | User the process runs as |
| `UMASK` | `002` | File creation mask - 002 keeps new folders group-writable for the *Arr containers |
| `TRUST_PROXY` | `false` | Set when behind a reverse proxy |
| `CORS_ORIGINS` | *(empty)* | Comma-separated origins; CORS stays off when empty |
| `WEB_ROOT` | *(bundled)* | Override the static SPA directory |
| `MIGRATIONS_DIR` | *(bundled)* | Override the migrations directory |

## API

Everything lives under `/api`. Errors always come back as
`{ "error": { "code", "message", "details?" } }`.

### Instances

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/instances` | List instances (never includes the API key) |
| `POST` | `/api/instances` | Create; probes the instance and returns `{ instance, test }` |
| `GET` | `/api/instances/:id` | One instance |
| `PATCH` | `/api/instances/:id` | Update; re-probes and drops cached data when the connection changed |
| `DELETE` | `/api/instances/:id` | Remove instance, queue items and snapshots (FK cascade) |
| `POST` | `/api/instances/:id/test` | Re-probe a stored instance |
| `POST` | `/api/instances/test` | Probe credentials that have not been saved |

### Resources

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/instances/:id/resources?refresh=` | Tags (with attachment counts), root folders, import lists |
| `GET` | `/api/instances/:id/media?page=&pageSize=&search=&tagId=&rootFolderPath=&refresh=` | Paged media |
| `POST` | `/api/instances/:id/refresh` | Drop the cached snapshot |

Reads are served from `resource_snapshots` and every response carries `fetchedAt`, so the
UI can say how stale the view is. A successful run invalidates the cache automatically.

### Storage

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/storage/roots` | Configured roots with writability, device id and free space |
| `GET` | `/api/storage/list?path=` | One directory (lazy - never a recursive walk) |
| `GET` | `/api/storage/measure?path=` | Recursive size and file count, cancellable and capped |
| `POST` | `/api/storage/preflight` | `{ op, payload }` -> checks, warnings and blockers |
| `GET` | `/api/storage/reconcile?refresh=` | Orphans, missing paths and mapping mismatches |

Disk operations are staged through the same `POST /api/queue` as everything else - there is
no endpoint that mutates the disk directly.

### Queue

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/queue?status=&instanceId=` | Staged items plus the active run |
| `POST` | `/api/queue` | Stage one item, an array, or `{ items: [...] }` - atomic |
| `GET` | `/api/queue/:id` | One item with its full *Arr request/response audit trail |
| `PATCH` | `/api/queue/reorder` | `{ itemIds }` - must list every pending item exactly once |
| `POST` | `/api/queue/:id/retry` | Put a failed item back to `pending` |
| `DELETE` | `/api/queue/:id` | Remove a staged item |
| `DELETE` | `/api/queue?statuses=` | Clear finished items (default: succeeded, failed, skipped, cancelled) |

### Runs

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/queue/runs` | Apply All - `{ onError?, itemIds? }`, returns `202` |
| `GET` | `/api/queue/runs` | Recent runs |
| `GET` | `/api/queue/runs/:id` | Run state plus its items |
| `GET` | `/api/queue/runs/:id/stream` | SSE progress - see below |
| `GET` | `/api/queue/runs/:id/events?sinceId=` | Polling alternative to SSE |
| `POST` | `/api/queue/runs/:id/resume` | Continue a paused run - `{ retryFailed?, skipFailed? }` |
| `POST` | `/api/queue/runs/:id/cancel` | Abort the in-flight step and stand down the rest |

## The fleet views

The architectural rule: **there is no instance switcher.** Every view loads every enabled
instance in parallel and renders them as columns, so parity, gaps and drift are visible in
one pass and a single action can target many instances at once.

### Visual language

The same five states are used everywhere - nothing else carries meaning:

| Cue | Meaning |
|---|---|
| solid green cell + count | present, with how many media items carry it |
| dashed empty cell | missing on that instance (click to stage it there) |
| amber | drift: partial parity, an inaccessible mount, or a setting that disagrees |
| violet ring + glyph | a staged operation is pending for this cell |
| red `?` | that instance did not answer - unknown, deliberately *not* "missing" |

An unreachable instance is never rendered as a configuration gap, and batch actions skip
it. That distinction is enforced in `buildTagRows`/`buildRootFolderRows` (`cell.known`) and
covered by tests.

### Tag parity matrix

Unique tags down the Y axis, instances across the X axis. Each cell shows the attached
media count plus a `+n cfg` marker when the tag is also referenced by indexers, import
lists or notifications. Row-level parity badges read `in sync 3/3`, `drift 2/3`,
`single 1/3`, and a row is flagged `unused` when nothing anywhere references it.

Batch actions, all fanning out across the targeted instances:

- **Propagate missing** - one `tag.create` per instance that lacks the tag, for every
  selected row at once.
- **Bulk rename** - one `tag.rename` per instance that has it, each with that instance's
  own tag id.
- **Find &amp; replace across the fleet** - live preview of every match on every instance.
  Where the new label already exists on an instance, the operation becomes a `tag.merge`
  into the existing tag rather than a rename *Arr would reject with "Label already exists".
- **Delete** - with an explicit count of the media that would lose the tag.

Clicking a single cell is the fast path: a gap stages one create, an occupied cell opens
the delete dialog scoped to that instance.

### Root folder topology

Paths down the Y axis, free space per instance in the cells, and a per-instance total in
the footer. Above the table sits the discrepancy report: paths are grouped by their last
segment, and a group is flagged when sibling instances disagree about where the same
library lives - `/data/media/movies` on one, `/media/movies` on another. A group that one
instance holds *entirely* is not flagged, because that is a deliberate split rather than
drift.

Re-mapping is the multi-instance staged action:

1. create the destination root folder on instances that lack it,
2. move the media there (`PUT /{movie|series}/editor`), each move depending on its
   instance's create,
3. optionally remove the old root folder, depending on that instance's move succeeding.

`moveFiles` is a deliberate, separate choice with the consequence spelled out in the
dialog - off means only the assignment changes, on means *Arr physically relocates files.

### Import list fleet

Lists are matched by name across instances, with `path drift`, `profile drift` and
`state drift` badges when the same list is configured differently. Enable/disable and root
folder alignment fan out across the selection; the update round-trips each list's full
body so implementation-specific fields survive.

### The staging drawer

A GParted-style tray pinned to the bottom of every screen, showing what is about to happen
and nothing more until you press Apply All:

- an impact sentence - *"Modifying 3 tags, 1 root folder across 4 instances (12 API
  operations total)"* - plus how many media items are touched,
- grouping by **execution order** (what Apply All will actually do) or **by instance**,
- per-operation inspect, reorder, retry and discard, with destructive operations flagged,
- the on-failure policy (halt / keep going / abort) chosen before the run starts.

The execution modal then tracks the run step by step: progress bar, the active instance and
operation, per-step status, the live log, and halt controls. When a step fails the queue
stops there and the modal offers *retry failed* or *skip failed* - the same safety halt the
backend enforces, surfaced where the decision is made.

## Storage access

ArrRanger can also work directly on the media on disk - inspect folders, create, rename,
move and prune them - and those operations go into the *same* staging queue as the *Arr
changes. That is what makes a mixed recipe possible:

> rename the folder on disk, **then** tell Radarr its new root folder with
> `moveFiles: false`, so nothing gets copied.

### The one rule

**ArrRanger must see media at exactly the same container path the *Arr apps use.** Paths
are compared literally; there is deliberately no translation layer, because a wrong mapping
that silently "works" would be far more dangerous than one that refuses. If the paths do
not line up, the Storage view says so per instance and tells you which mounts it has.

```yaml
services:
  radarr:
    volumes:
      - /mnt/user/data:/data            # Radarr sees /data/media/movies
  arrranger:
    volumes:
      - /mnt/cache/appdata/arrranger:/config
      - /mnt/user/data:/data:rw         # so must ArrRanger
    environment:
      FS_ROOTS: /data
      PUID: "99"                        # the same ids the *Arr containers run as
      PGID: "100"
      UMASK: "002"                      # new folders stay group-writable
```

One binding for the whole tree, not one per library: a rename is only atomic *inside* a
single filesystem, and separate bindings turn every move into a cross-device copy that
ArrRanger refuses (see below). This is the same reasoning behind the well-known
single-`/data`-volume layout for hardlinks and atomic moves.

### Permissions

The container needs write access as `PUID:PGID`; it never tries to take it. The entrypoint
reports what it found at boot, so a mismatch is one `docker logs` away:

```
[arrranger] storage root /data owner=99:100 mode=775 writable as 99:100
[arrranger] storage root /data owner=0:0 mode=755 NOT WRITABLE as 99:100
[arrranger]   fix: match PUID/PGID to the owner above, or give that group write access
```

`/config` is chowned to `PUID:PGID` as before. **Media roots are never chowned** - a
recursive chown across an array is slow, destructive, and not ArrRanger's business.

On Unraid, `/mnt/user/data` is the right source for media (the FUSE share layer is fine
here, unlike for the SQLite database, which belongs on the cache disk).

### What it will and will not do

| | |
|---|---|
| Scope | Directories only. No file-level create, rename or delete. |
| Traversal | Every path is resolved against the configured roots; the parent chain is realpath'd, so a symlink cannot be used to escape. A symlink *leaf* is left unresolved, so "move this link" can never silently move the library behind it. |
| Symlinks | Shown in the explorer, never followed and never mutated. |
| Deleting | Hard delete, no recycle bin. Non-empty needs `recursive`; a folder a connected instance still tracks needs `force`; the UI makes you type the folder name. Deleting a storage root or a mount point is refused outright. |
| Cross-filesystem moves | **Refused.** The preflight compares device ids and reports how much would have to be copied: move it with your own tool (unBALANCE, rsync), then use Reconcile &amp; Align. |
| Preflight | Runs before staging *and* again immediately before execution, so a staged operation that went stale fails with `fs_precondition_failed` instead of acting on a filesystem nobody reviewed. |

### The storage view

`/storage` is a lazy explorer over the configured roots - it never walks a whole library -
with the reconciliation report folded in:

- **orphan** - a folder on disk that no connected instance has media at
- **missing** - a path an instance believes in that is not on disk (shown struck through in
  the listing where it should have been)
- **tracked** - matched, with how many instances own it
- **empty**, **symlink**, **no access**

Recursive size is opt-in per folder. Every mutation is staged, badged in the listing while
pending, and recorded in the audit trail exactly like an HTTP exchange:

```
[debug] rename /data/movies -> /data/films (0ms)
        request: {"from":"/data/movies","to":"/data/films"}
[info]  Renamed /data/movies to /data/films
```

### Reconcile &amp; Align

The headline workflow. Pick a tracked folder, give it a new name, choose which instances to
realign, and ArrRanger stages one dependent chain:

```
1. fs.rename /data/movies -> /data/films                    (host, no instance)
2. rootFolder.create /data/films        on Radarr-4K   waits for 1
3. media.moveRootFolder {moveFiles: false}  on Radarr-4K   waits for 2   ← no copy
4. media.refresh                        on Radarr-4K   waits for 3
5. rootFolder.delete /data/movies       on Radarr-4K   waits for 3
```

If the disk step fails, every step behind it is skipped and the run halts - verified in a
container: with the volume read-only, the rename failed with `fs_permission_denied` and
**zero *Arr requests were made**.

## The queue engine

### Action types

The four action types from the original brief map onto the operation contract in
[packages/shared/src/queue.ts](packages/shared/src/queue.ts):

| Brief | Operation(s) | *Arr call |
|---|---|---|
| `RENAME_TAG` | `tag.rename` | `PUT /api/v3/tag/{id}` with the raw tag merged |
| `DELETE_TAG` | `tag.delete` | optional editor detach, then `DELETE /api/v3/tag/{id}` |
| `REASSIGN_TAG` | `mediaTags.add`, `mediaTags.remove`, `tag.merge` | `PUT /api/v3/{movie\|series}/editor` with `applyTags` |
| `CHANGE_ROOT_FOLDER` | `media.moveRootFolder`, `rootFolder.create`, `rootFolder.delete` | editor with `rootFolderPath` + `moveFiles` |

`tag.create`, `media.refresh`, `importList.update`, `importList.delete` and
`importList.setEnabled` round out the *Arr set, and four filesystem operations -
`fs.mkdir`, `fs.rename`, `fs.move`, `fs.delete` (the brief's `FS_MKDIR`/`FS_RENAME`/
`FS_MOVE`/`FS_DELETE`) - act on storage instead.

Operations are split into two families, `ArrOp` and `FsOp`, with a handler map each. An
*Arr item always names an instance; a filesystem item never does, and the database enforces
that with a `CHECK` on `(kind, instance_id)`. Adding an operation to `QueueOpPayloads`
breaks compilation everywhere it is not yet handled - both handler maps, the summary
renderer and the target resolver are keyed by their op family.

### Safety halt

`onError` decides what happens when step N fails:

- **`pause` (default)** - the run stops immediately. The failed item keeps its error code,
  message and HTTP status; every later item stays `pending`. Nothing runs half-applied.
- **`continue`** - the failure is recorded and the run moves on.
- **`abort`** - the failure ends the run and everything still queued is `cancelled`.

A paused run blocks new runs until it is resumed (`retryFailed` / `skipFailed`) or
cancelled, so two runs can never touch an instance at once.

### Dependencies

An item can carry `dependsOnId`, and the dependency may be of the *other* kind. The
executor passes the dependency's stored result into the handler, which is how "create tag
X, then apply it to 40 movies" works: stage `tag.create`, then `mediaTags.add` with an empty
`tagIds` and `dependsOnId` set. If the dependency fails, the dependent item is `skipped`
rather than run against a wrong id.

That is also the mechanism behind mixed recipes: a `rootFolder.create` that waits for an
`fs.rename` cannot run if the folder was never renamed.

### Progress

`GET /api/queue/runs/:id/stream` is a standard `text/event-stream`:

```
id: 14
event: item.finished
data: {"type":"item.finished","runId":2,"item":{…},"run":{…}}
```

Frame types are `run.started`, `item.started`, `item.finished`, `log`, `run.paused` and
`run.finished`. A short per-run replay buffer plus `Last-Event-ID` means a client that
connects late - or reconnects - still sees the steps it missed. Clients that cannot use
SSE can poll `/events?sinceId=` instead.

### Restart recovery

A container that dies mid-run leaves rows claiming to be `running`. On boot those runs are
parked as `paused` and the in-flight item is marked `failed` with code `interrupted` - the
*Arr instance may or may not have applied it, so the decision is handed back to the user.

## Data and security

- API keys are encrypted with AES-256-GCM before being written to SQLite, using a key
  derived from `ARRRANGER_SECRET` (or `/config/secret.key` if that variable is unset).
  This protects against a stray `cat arrranger.db`; it is not protection against someone
  who holds both the volume and the environment.
- The API key is never returned by the HTTP API - see the `Instance` vs `InstanceWithKey`
  split in [packages/shared/src/instance.ts](packages/shared/src/instance.ts).
- ArrRanger has no authentication of its own. Put it behind your existing reverse proxy /
  SSO if it is reachable from outside your LAN.

## *Arr API notes

Two rules the code follows everywhere, both learned from how Radarr/Sonarr v3 actually
behave:

1. **Parse narrow, keep raw.** Responses are wide and differ per app and per version, so
   Zod schemas validate only the fields that are rendered, and the untouched response body
   is carried alongside as `raw` (`ArrResource<TView>`).
2. **`PUT` replaces the resource.** A partial body silently wipes omitted fields, so every
   edit is *fetch raw → merge the changed keys → PUT the merged object back*
   (`mergeForPut`).

Two v3 limitations shaped the design:

- **There is no `PUT /api/v3/rootfolder`.** Root folders can only be created and deleted,
  so "changing" one is really *create the new folder → move the media with the editor →
  delete the old folder* - three staged steps, which is exactly what the queue models.
- **`/movie` and `/series` do not paginate.** Both return the entire library, so the list
  is fetched once into `resource_snapshots` and paged, searched and filtered in the
  server. Radarr gets `excludeLocalCovers=true` and Sonarr `includeSeasonImages=false` to
  keep the payload down.

Errors are mapped to codes the UI can act on rather than raw statuses: `arr_unauthorized`,
`arr_not_found` (usually a wrong URL base), `arr_validation_failed` (the 400 body's
`propertyName: errorMessage` pairs, joined), `arr_timeout`, `arr_unreachable`,
`arr_dns_failure`, `arr_tls_untrusted` (self-signed certificate - turn off Verify SSL),
`arr_unexpected_response` (a proxy login page instead of JSON) and `arr_conflict`.

## Toolchain decisions

- **TypeScript is pinned to `~5.9`.** TypeScript 7 builds the server and shared packages
  fine, but `vue-tsc` 3.x still resolves `typescript/lib/tsc`, which the native compiler
  does not expose. Unpin once vue-tsc supports it.
- **All build tooling lives in the root `package.json`.** npm's `--omit=dev` skips the
  root's devDependencies but *not* a workspace's, so anything left in a workspace's
  devDependencies would ship in the runtime image. Vue, Vite and friends are
  devDependencies of `@arrranger/web` for the same reason - Vite inlines them into
  `apps/web/dist` at build time.
- **Migrations bracket `PRAGMA foreign_keys`.** SQLite cannot relax `NOT NULL` or edit a
  `CHECK`, so making `queue_items.instance_id` nullable meant the standard table rebuild.
  With foreign keys enforced, dropping the old table cascades through
  `queue_events.item_id ON DELETE CASCADE` and silently takes the whole audit trail with it -
  and the pragma is a no-op inside a transaction, where migrations run. The runner therefore
  toggles it outside the transaction and runs `foreign_key_check` afterwards. Covered by a
  test that seeds a v1 database with items *and* events.
- **Frontend tests use Vitest + happy-dom.** No browser was involved: the views are
  mounted headlessly with the API layer mocked, which verifies rendering, interaction and
  store wiring. Visual styling itself is not asserted.
- **`better-sqlite3` install script.** npm 11.16+ gates install scripts behind
  `allowScripts` in package.json. The package ships musl prebuilds, but the npm inside
  the base image still runs the implicit `node-gyp rebuild`, so the builder stage
  installs `python3 make g++`. None of it reaches the runtime image.
