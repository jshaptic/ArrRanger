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
| Cross-filesystem moves | **Refused.** The preflight compares device ids and reports how much would have to be copied: move it with your own tool (unBALANCE, rsync), then re-map the instances onto it. |
| Preflight | Runs before staging *and* again immediately before execution, so a staged operation that went stale fails with `fs_precondition_failed` instead of acting on a filesystem nobody reviewed. |

### Rename &amp; align

The headline workflow, and the reason renaming is one action rather than two: it is the
`rename` dialog on any folder an instance roots at, where the owning instances are listed
as checkboxes. Give the folder a new name, leave the instances ticked, and ArrRanger stages
one dependent chain:

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

An instance that roots here but has downloaded nothing yet skips steps 3 and 4 - there are
no ids to bulk-edit, and an editor call with an empty list is a request *Arr has no reason
to accept - but it still gets steps 2 and 5, because a root folder is configuration and
being empty is not a reason to leave it pointing at a path that no longer exists.

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
