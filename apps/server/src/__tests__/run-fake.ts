/** Dev helper: `npx tsx src/__tests__/run-fake.ts` starts a fake Radarr to click around. */
import { startFakeArr } from './fake-arr.js';

const kind = process.argv[2] === 'sonarr' ? 'sonarr' : 'radarr';
const server = await startFakeArr({ kind });
process.stdout.write(`${server.url}\n`);

const report = (): void => {
  process.stderr.write(`TAGS ${JSON.stringify(server.state.tags)}\n`);
  process.stderr.write(`MEDIA ${JSON.stringify(server.state.media.map((m) => ({ id: m.id, tags: m.tags, path: m.path })))}\n`);
};

process.on('SIGUSR2', report);
process.on('SIGTERM', () => {
  report();
  void server.close().then(() => process.exit(0));
});
