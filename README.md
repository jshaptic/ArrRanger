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
| `FS_LOW_SPACE_BYTES` | `50GiB` | A filesystem below this free space is flagged low. Accepts units: `50G`, `500MiB`, or a plain byte count. `0` disables. |
| `FS_LOW_SPACE_PERCENT` | `0` | Also flag below this percentage free, OR'd with the floor above. Off by default - a ratio is loud on a large array. |
| `TZ` | `Etc/UTC` | Container timezone |
| `PUID` / `PGID` | `99` / `100` | User the process runs as |
| `UMASK` | `002` | File creation mask - 002 keeps new folders group-writable for the *Arr containers |
| `TRUST_PROXY` | `false` | Set when behind a reverse proxy |
| `CORS_ORIGINS` | *(empty)* | Comma-separated origins; CORS stays off when empty |
| `WEB_ROOT` | *(bundled)* | Override the static SPA directory |
| `MIGRATIONS_DIR` | *(bundled)* | Override the migrations directory |

## The fleet views

The architectural rule: **there is no instance switcher.** Every view loads every enabled
instance in parallel, so parity, gaps and drift are visible in one pass and a single action
can target many instances at once.

For tags and import lists that means instances *are* the X axis: the same tag genuinely
exists on many instances, and comparing it is the whole point. Folders are not like that -
one folder belongs to one instance - so `/paths` keeps the fleet-wide load and drops the
axis; see [The folder view](#the-folder-view).

The rule is also why storage is not a separate view: changing a folder on disk and changing
which instances root at it are one job, so they are one table.

### Visual language

In the matrices - tags and import lists - the same five cell states are used, and nothing
else carries meaning:

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

The folder view has no cells to colour, so it carries the same invariant differently: an
instance that did not answer is absent from every row's owners, and the view says so once,
above the table, rather than in a `?` per row. Amber and red survive as a per-row
**severity** glyph.

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

### The folder view

`/paths` replaces what used to be two views - a root-folder matrix that could not see the
disk, and a storage explorer that could not compare instances. Every real task crosses that
line: renaming a folder means re-pointing root folders, and adding a root folder means the
folder has to exist. So there is one table.

**Rows are folders.** A folder is managed and monitored in its own right, and the instances
that use it are a column - not the axis. That is the one place the fleet's column layout is
deliberately dropped, because a folder is essentially never reused by two instances: each
roots at its own subtree, so an instance axis would be N columns of dashes to express the
single fact that Radarr owns this one. The width goes to disk facts and health instead:

```
Path                    Used by      Media   Size     Modified   Free      State
▾ /data                  ● Radarr     496     —        —          1.2 TB
  ▾ media                ● Sonarr
    ▸ movies             ● Radarr     384     2.1 TB   2d ago     1.2 TB    root folder
    ▸ movies-4k          ● Radarr-4K  112     900 GB   5h ago     1.2 TB    root folder
  ⚠ ▸ old-movies         —            814     1.4 TB   3mo ago    1.2 TB    not a root folder · unmanaged
    ▸ tv                 ● Sonarr     220     3.0 TB   1h ago     1.2 TB    root folder
```

The rows form a lazily-expanded tree; the first load opens only the *spine* - every mount,
and the directory chain down to each *Arr root folder. Everything below a root folder starts
collapsed, because that is where the library lives.

**Root folders are leaves.** Below one lies the library - hundreds of media folders this
view neither manages nor reads. Not expanding them is both the honest scope and the
performance story: skipping a `readdir` of every root folder cut a 79-root-folder fleet's
first paint from 2.2s to under a second. What each instance tracks under a root folder is
still shown, from the index, for free.

#### Used by

An owner chip says how one instance uses the folder, in precedence order:

| Use | Meaning |
|---|---|
| `rootFolder` | a root folder at exactly this path (click the chip to stage its removal) |
| `tracked` | a media item at exactly this path |
| `ancestor` | media lives *under* here - the folder's reason to exist |

An instance that uses the folder in none of those ways is simply **absent**, which is what
replaced the old `inside`/`outside` cells: "inside a root folder and tracking nothing" is
already said by the `untracked` badge, and "unrelated to my root folders" is said by having
no chip. An unreachable instance is absent too - so a folder with no owner shows `— ?`, and
the count of instances that did not answer is stated above the table. Unknown, deliberately
not "nobody".

Two instances rooting at one folder is legal and renders as two chips. It is supported, not
optimised for, and it is deliberately *not* called drift.

#### Monitoring

Row badges are computed server-side so the vocabulary cannot drift: `root folder`,
**`not a root folder`**, `untracked`, `unmanaged`, `missing`, `not mounted here`, `empty`,
`symlink`, `no access`, `read-only`. The second of those is the question the view exists to
answer - a folder sitting alongside your root folders that no instance roots at.

Those collapse into one **severity** per row, so a glance is enough and a problem two levels
down is not invisible:

| Severity | Source | Rendered |
|---|---|---|
| `error` | `not mounted here`, `missing`, `no access` | red `✕` |
| `warn` | `not a root folder`, `unmanaged`, `read-only`, low free space, a root folder its own instance calls inaccessible | amber `⚠` |
| `info` | `untracked`, `empty`, `symlink` | nothing |
| `ok` | none of the above | nothing |

`untracked` is only `info` on purpose. It fires on every non-media folder inside a root
folder, so promoting it would paint a healthy library amber and bury the two `warn` states
that are actually questions. A collapsed row also shows a dimmed `⚠` when the level below it
holds something worse than itself.

There is deliberately **no parity or drift reporting here**. This view is for reorganising
and monitoring folders in their own right; comparing a setting across instances and
aligning it is what the tag and import-list matrices are for. A fleet where each instance
roots at its own subfolder is a normal layout, and calling all 79 of its root folders
"drifted" was noise, not information.

Root folders outside `FS_ROOTS`, or absent from disk, are **rows**, not a footnote: the
first are marked `not mounted here` (with the mapping explanation still shown above the
table), the second are struck through in their real tree position, at any depth.

`missing` means *an instance holds a file for this path and the disk does not have it*.
A monitored film nobody has downloaded yet also has a path that does not exist - Radarr
assigns one up front - and that is not a problem, so those are not rows. Without that
distinction a healthy 384-film library reported 998 "missing" folders; with it, it
reports none.

#### Free space is monitored per filesystem, not per instance

Every row reports the free space of the filesystem it is on, resolved by device id with one
`statfs` per distinct filesystem per request and seeded from the `FS_ROOTS` mounts - so the
usual single-`/data`-volume layout costs no extra syscalls. One line per mount above the
table gives the aggregate.

The `⚠ low` marker fires below `FS_LOW_SPACE_BYTES` (50 GiB by default, roughly one 4K remux
plus margin, so it means "the next import may not fit") or below `FS_LOW_SPACE_PERCENT` of
the total. The ratio ships disabled: 10% of a 50 TB array is 5 TB, which still holds fifty
films, so a percentage is the rule you tune rather than the one you inherit.

It only ever lands on a **mount or a root folder**. Every row under a root folder shares its
filesystem, so flagging them all would paint a whole library amber and say nothing you could
act on. The old per-instance free-space footer is gone for the same reason it was wrong: it
summed each instance's root folders, double-counting one disk whenever two instances rooted
on it.

#### The instance filter

The fleet bar is a **filter** on this view, not an action target: selecting instances narrows
the tree to the folders they own. Scoping is server-side (`?instance=` is repeatable, like
`path`), because everything a client would filter on is server-derived - the spine itself is
built from the selected instances' root folders, and `matched`, `truncated` and every rollup
count come from the full candidate set. A client-side filter would leave the summary row
describing rows it had just removed.

The bar keeps listing every instance whatever is selected, so the filter can always be turned
off, and a summary row says what it is counting: `3 of 814 folders here belong to Radarr-4K`.

#### A folder that still holds a whole library

The case that prompted this: a folder full of films that is no longer anybody's root
folder. The table never renders it. Expanding yields one summary row plus only the
children that need attention:

```
▾ /data/media/old-movies                          not a root folder · unmanaged
    Orphan Film (1999)              untracked
    Gone (2001)                     missing
  └ showing 3 of 814 folders here · 806 tracked · 4 untracked · 2 missing   [show more]
```

The summary row states one thing at a time. During a search it says what the search
matched - `1 of 9 folders here match "onepiece"` - and drops the state counts, because
those describe entries that are not on screen. An instance filter does the same.

The counts are exact even though the rows are a subset, because they come from one
`readdir` plus an in-memory index rather than from the rows returned. The rule that makes
it affordable: **`only`, `q` and `limit` are applied before any per-child `stat`.** A level
of 64 entries or fewer is served whole and fully probed, exactly like the old explorer; a
bigger one defaults to problems-only. `empty` and `no access` are the two counts that need
a read per child, so on a big level they are reported as *not evaluated* (`null`) rather
than as zero.

That rule is also why the sort control offers only **Name** and **Needs attention**, and not
"Modified". A level's entries come from one `readdir`, which carries no mtime, so ordering by
it would mean statting all 814 children *before* paging - exactly the cost the design exists
to avoid. The Modified column still reports the fact for the rows that were probed.

#### Depth is where the old scan was wrong

The retired reconcile scan classified only the direct children of a root folder. With a
nested layout - root folder `/data/media`, films at `/data/media/movies/Dune (2021)` - it
called `movies` an orphan. The server now keeps an **ancestor closure** over every media
path (`PathIndexService`), so "does any instance track anything at or under this path" is
an O(1) answer at any depth. That is also why the join is server-side: the browser would
need the fleet's whole library to compute it.

#### Actions

Row actions are derived from the folder itself: `remove`, `re-map` and `align` from its
owners, `add root folder` from whether any reachable instance could take one here, and
`new folder`, `rename`, `move`, `prune` from what is on disk. A mount is never renameable,
and a prune is only offered when nothing anywhere would lose media by it.

**Which instance is never inferred from the fleet bar.** An action that removes or realigns
takes its instances from the folder's own owners, and the dialog names each one before
anything is staged; an action that *adds* a root folder asks, because a folder with no owner
has nothing to infer from. That is what lets the bar be a filter without any action silently
changing meaning.

**Not offered on purpose:** an align chain for renaming an individual *media* folder.
`media.moveRootFolder` only sets `rootFolderPath`, and `media.refresh` re-reads each item's
stored path, so nothing in the current operation set can make *Arr adopt a renamed media
folder - it would report the item missing. The plain disk rename is offered instead, with a
warning naming the instances and item counts it would leave dangling.

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
not line up, the folder view says so per instance and tells you which mounts it has.

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
| Symlinks | Shown in the folder view, never followed and never mutated. |
| Deleting | Hard delete, no recycle bin. Non-empty needs `recursive`; a folder a connected instance still tracks needs `force`, and so does one ArrRanger cannot *check* - an unreachable instance is never read as a cleared one; the UI makes you type the folder name. Deleting a storage root or a mount point is refused outright. |
| Cross-filesystem moves | **Refused.** The preflight compares device ids and reports how much would have to be copied: move it with your own tool (unBALANCE, rsync), then use Reconcile &amp; Align. |
| Preflight | Runs before staging *and* again immediately before execution, so a staged operation that went stale fails with `fs_precondition_failed` instead of acting on a filesystem nobody reviewed. |

### Reconcile &amp; Align

The headline workflow, reached from the `align` action on any row in the folder view that
an instance points at. Pick a tracked folder, give it a new name, choose which instances to
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
