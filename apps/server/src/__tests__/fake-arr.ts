import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for a real Radarr/Sonarr v3 API, faithful to the details this codebase
 * depends on: X-Api-Key auth, the movieIds/seriesIds split, the editor endpoint, and
 * 400 bodies shaped as an array of validation failures.
 */

export interface FakeTag {
  id: number;
  label: string;
}

export interface FakeRootFolder {
  id: number;
  path: string;
  accessible: boolean;
  freeSpace: number;
  totalSpace: number;
  unmappedFolders: unknown[];
}

export interface FakeMedia {
  id: number;
  title: string;
  sortTitle: string;
  path: string;
  rootFolderPath: string;
  qualityProfileId: number;
  monitored: boolean;
  tags: number[];
  year: number;
  sizeOnDisk: number;
  /** An extra field the client must preserve but never parses. */
  images: Array<{ coverType: string; remoteUrl: string }>;
}

export interface FakeImportList {
  id: number;
  name: string;
  implementation: string;
  configContract: string;
  enabled: boolean;
  enableAuto?: boolean;
  enableAutomaticAdd?: boolean;
  rootFolderPath: string;
  qualityProfileId: number;
  monitor: string;
  minimumAvailability?: string;
  seasonFolder?: boolean;
  tags: number[];
  fields: Array<{ name: string; value?: unknown }>;
  /** Set by the fake to prove PUT round-trips unknown keys instead of dropping them. */
  secretServerField: string;
}

export interface FakeCommand {
  id: number;
  name: string;
  body: Record<string, unknown>;
}

export interface FakeArrState {
  tags: FakeTag[];
  rootFolders: FakeRootFolder[];
  media: FakeMedia[];
  importLists: FakeImportList[];
  commands: FakeCommand[];
}

export interface FakeArrBehaviour {
  /** Artificial latency, for timeout tests. */
  delayMs: number;
  /** Renaming a tag to this label answers with an *Arr-style 400. */
  rejectTagLabel: string | null;
  /** Serve HTML instead of JSON, like a reverse proxy login page. */
  serveHtml: boolean;
}

export interface FakeArrServer {
  readonly url: string;
  readonly kind: 'radarr' | 'sonarr';
  readonly state: FakeArrState;
  readonly behaviour: FakeArrBehaviour;
  readonly requests: Array<{ method: string; path: string }>;
  close(): Promise<void>;
}

function defaultState(): FakeArrState {
  return {
    tags: [
      { id: 1, label: 'hd' },
      { id: 2, label: 'kids' },
      { id: 3, label: 'archive' },
    ],
    rootFolders: [
      {
        id: 1,
        path: '/data/media',
        accessible: true,
        freeSpace: 1_000_000_000,
        totalSpace: 4_000_000_000,
        unmappedFolders: [],
      },
      {
        id: 2,
        path: '/data/media-4k',
        accessible: true,
        freeSpace: 2_000_000_000,
        totalSpace: 8_000_000_000,
        unmappedFolders: [],
      },
    ],
    media: [
      makeMedia(10, 'Arrival', '/data/media/Arrival (2016)', [1]),
      makeMedia(11, 'Dune', '/data/media/Dune (2021)', [1, 2]),
      makeMedia(12, 'Heat', '/data/media/Heat (1995)', [3]),
      makeMedia(13, 'Interstellar', '/data/media/Interstellar (2014)', []),
    ],
    commands: [],
    importLists: [
      {
        id: 1,
        name: 'Trakt watchlist',
        implementation: 'TraktListImport',
        configContract: 'TraktListSettings',
        enabled: true,
        enableAuto: true,
        rootFolderPath: '/data/media',
        qualityProfileId: 1,
        monitor: 'movieOnly',
        minimumAvailability: 'released',
        tags: [],
        fields: [{ name: 'listName', value: 'watchlist' }],
        secretServerField: 'must-survive-put',
      },
    ],
  };
}

function makeMedia(id: number, title: string, path: string, tags: number[]): FakeMedia {
  return {
    id,
    title,
    sortTitle: title.toLowerCase(),
    path,
    rootFolderPath: path.slice(0, path.lastIndexOf('/')),
    qualityProfileId: 1,
    monitored: true,
    tags,
    year: 2000 + (id % 20),
    sizeOnDisk: id * 1_000_000,
    images: [{ coverType: 'poster', remoteUrl: `https://example.invalid/${id}.jpg` }],
  };
}

function validationFailure(propertyName: string, errorMessage: string): unknown[] {
  return [{ propertyName, errorMessage, severity: 'error' }];
}

export async function startFakeArr(
  options: { kind?: 'radarr' | 'sonarr'; apiKey?: string; host?: string } = {},
): Promise<FakeArrServer> {
  const kind = options.kind ?? 'radarr';
  const apiKey = options.apiKey ?? 'fake-api-key-0123456789';
  const state = defaultState();
  const behaviour: FakeArrBehaviour = { delayMs: 0, rejectTagLabel: null, serveHtml: false };
  const requests: Array<{ method: string; path: string }> = [];

  const mediaPath = kind === 'radarr' ? '/movie' : '/series';
  const idKey = kind === 'radarr' ? 'movieIds' : 'seriesIds';
  const detailKey = kind === 'radarr' ? 'movieIds' : 'seriesIds';

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // A cancelled run aborts in-flight requests: the socket dies while we are still
    // reading the body, which rejects the async iterator. That is expected here.
    void handle(req, res).catch(() => {
      if (!res.writableEnded) res.destroy();
    });
  });

  async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    return text.length === 0 ? {} : (JSON.parse(text) as Record<string, unknown>);
  }

  function send(res: ServerResponse, status: number, body: unknown): void {
    if (res.writableEnded || res.destroyed) return;
    const payload = JSON.stringify(body ?? null);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(payload);
  }

  function tagDetail(tag: FakeTag): Record<string, unknown> {
    return {
      id: tag.id,
      label: tag.label,
      [detailKey]: state.media.filter((m) => m.tags.includes(tag.id)).map((m) => m.id),
      indexerIds: [],
      importListIds: [],
      notificationIds: [],
      restrictionIds: [],
      delayProfileIds: [],
    };
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://fake.local');
    const path = url.pathname.replace(/^\/api\/v3/, '');
    const method = req.method ?? 'GET';
    requests.push({ method, path });

    if (behaviour.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, behaviour.delayMs));
    }

    if (behaviour.serveHtml) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>Sign in to continue</body></html>');
      return;
    }

    if (req.headers['x-api-key'] !== apiKey) {
      send(res, 401, { error: 'Unauthorized' });
      return;
    }

    // ------------------------------------------------------------- system
    if (method === 'GET' && path === '/system/status') {
      send(res, 200, {
        appName: kind === 'radarr' ? 'Radarr' : 'Sonarr',
        instanceName: kind === 'radarr' ? 'Radarr' : 'Sonarr',
        version: '5.14.0.9383',
        isDocker: true,
        urlBase: '',
      });
      return;
    }

    // --------------------------------------------------------------- tags
    if (method === 'GET' && path === '/tag') {
      send(res, 200, state.tags);
      return;
    }
    if (method === 'GET' && path === '/tag/detail') {
      send(res, 200, state.tags.map(tagDetail));
      return;
    }
    if (method === 'GET' && path.startsWith('/tag/detail/')) {
      const id = Number(path.split('/')[3]);
      const tag = state.tags.find((t) => t.id === id);
      if (!tag) return send(res, 404, { message: 'NotFound' });
      send(res, 200, tagDetail(tag));
      return;
    }
    if (method === 'GET' && /^\/tag\/\d+$/.test(path)) {
      const id = Number(path.split('/')[2]);
      const tag = state.tags.find((t) => t.id === id);
      if (!tag) return send(res, 404, { message: 'NotFound' });
      send(res, 200, tag);
      return;
    }
    if (method === 'POST' && path === '/tag') {
      const body = await readBody(req);
      const label = String(body['label'] ?? '');
      if (label.length === 0) {
        return send(res, 400, validationFailure('Label', 'Label must not be empty'));
      }
      if (state.tags.some((t) => t.label === label)) {
        return send(res, 400, validationFailure('Label', 'Label already exists'));
      }
      const tag: FakeTag = { id: Math.max(0, ...state.tags.map((t) => t.id)) + 1, label };
      state.tags.push(tag);
      send(res, 201, tag);
      return;
    }
    if (method === 'PUT' && /^\/tag\/\d+$/.test(path)) {
      const id = Number(path.split('/')[2]);
      const body = await readBody(req);
      const label = String(body['label'] ?? '');
      const tag = state.tags.find((t) => t.id === id);
      if (!tag) return send(res, 404, { message: 'NotFound' });
      if (behaviour.rejectTagLabel !== null && label === behaviour.rejectTagLabel) {
        return send(res, 400, validationFailure('Label', 'Label is not allowed by this instance'));
      }
      tag.label = label;
      send(res, 202, tag);
      return;
    }
    if (method === 'DELETE' && /^\/tag\/\d+$/.test(path)) {
      const id = Number(path.split('/')[2]);
      state.tags = state.tags.filter((t) => t.id !== id);
      for (const media of state.media) media.tags = media.tags.filter((t) => t !== id);
      send(res, 200, {});
      return;
    }

    // -------------------------------------------------------- root folders
    if (method === 'GET' && path === '/rootfolder') {
      send(res, 200, state.rootFolders);
      return;
    }
    if (method === 'POST' && path === '/rootfolder') {
      const body = await readBody(req);
      const folderPath = String(body['path'] ?? '');
      if (state.rootFolders.some((f) => f.path === folderPath)) {
        return send(res, 400, validationFailure('Path', 'This root folder has already been added'));
      }
      const folder: FakeRootFolder = {
        id: Math.max(0, ...state.rootFolders.map((f) => f.id)) + 1,
        path: folderPath,
        accessible: true,
        freeSpace: 500_000_000,
        totalSpace: 1_000_000_000,
        unmappedFolders: [],
      };
      state.rootFolders.push(folder);
      send(res, 201, folder);
      return;
    }
    if (method === 'DELETE' && /^\/rootfolder\/\d+$/.test(path)) {
      const id = Number(path.split('/')[2]);
      state.rootFolders = state.rootFolders.filter((f) => f.id !== id);
      send(res, 200, {});
      return;
    }

    // --------------------------------------------------------------- media
    if (method === 'GET' && path === mediaPath) {
      send(res, 200, state.media);
      return;
    }
    if (method === 'GET' && path.startsWith(`${mediaPath}/`) && !path.endsWith('/editor')) {
      const id = Number(path.split('/')[2]);
      const media = state.media.find((m) => m.id === id);
      if (!media) return send(res, 404, { message: 'NotFound' });
      send(res, 200, media);
      return;
    }
    if (method === 'PUT' && path === `${mediaPath}/editor`) {
      const body = await readBody(req);
      const ids = (body[idKey] as number[] | undefined) ?? [];
      const targets = state.media.filter((m) => ids.includes(m.id));

      if (targets.length === 0) {
        return send(res, 400, validationFailure(idKey, 'No matching items'));
      }

      const tags = (body['tags'] as number[] | undefined) ?? [];
      const applyTags = body['applyTags'] as string | undefined;
      const rootFolderPath = body['rootFolderPath'] as string | undefined;
      const moveFiles = body['moveFiles'] === true;

      for (const media of targets) {
        if (applyTags === 'add') {
          media.tags = [...new Set([...media.tags, ...tags])];
        } else if (applyTags === 'remove') {
          media.tags = media.tags.filter((t) => !tags.includes(t));
        } else if (applyTags === 'replace') {
          media.tags = [...tags];
        }

        if (rootFolderPath !== undefined) {
          const folder = state.rootFolders.find((f) => f.path === rootFolderPath);
          if (!folder) {
            return send(res, 400, validationFailure('RootFolderPath', 'Root folder does not exist'));
          }
          const leaf = media.path.slice(media.path.lastIndexOf('/') + 1);
          media.rootFolderPath = rootFolderPath;
          // Radarr only rewrites the path on disk when moveFiles is set.
          if (moveFiles) media.path = `${rootFolderPath}/${leaf}`;
        }
      }

      send(res, 202, targets);
      return;
    }

    // ------------------------------------------------------------ commands
    if (method === 'POST' && path === '/command') {
      const body = await readBody(req);
      const name = String(body['name'] ?? '');
      if (name.length === 0) {
        return send(res, 400, validationFailure('Name', 'Command name is required'));
      }
      const command: FakeCommand = { id: state.commands.length + 1, name, body };
      state.commands.push(command);
      send(res, 201, { id: command.id, name, status: 'queued' });
      return;
    }

    // -------------------------------------------------------- import lists
    if (method === 'GET' && path === '/importlist') {
      send(res, 200, state.importLists);
      return;
    }
    if (method === 'GET' && /^\/importlist\/\d+$/.test(path)) {
      const id = Number(path.split('/')[2]);
      const list = state.importLists.find((l) => l.id === id);
      if (!list) return send(res, 404, { message: 'NotFound' });
      send(res, 200, list);
      return;
    }
    if (method === 'PUT' && /^\/importlist\/\d+$/.test(path)) {
      const id = Number(path.split('/')[2]);
      const body = await readBody(req);
      const index = state.importLists.findIndex((l) => l.id === id);
      if (index === -1) return send(res, 404, { message: 'NotFound' });
      if (typeof body['secretServerField'] !== 'string') {
        // The real apps behave this way: a partial PUT wipes what it omits.
        return send(res, 400, validationFailure('SecretServerField', 'Field is required'));
      }
      const updated = { ...state.importLists[index], ...body } as FakeImportList;
      state.importLists[index] = updated;
      send(res, 202, updated);
      return;
    }
    if (method === 'DELETE' && /^\/importlist\/\d+$/.test(path)) {
      const id = Number(path.split('/')[2]);
      state.importLists = state.importLists.filter((l) => l.id !== id);
      send(res, 200, {});
      return;
    }

    send(res, 404, { message: `NotFound: ${method} ${path}` });
  }

  // Tests bind loopback; the manual container check binds all interfaces so a container
  // can reach it through the docker bridge.
  await new Promise<void>((resolve) => server.listen(0, options.host ?? '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    kind,
    state,
    behaviour,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error?: Error) => (error ? reject(error) : resolve()));
      }),
  };
}

export function serverApiKey(): string {
  return 'fake-api-key-0123456789';
}
