import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { closeDatabase, openDatabase } from './db/client.js';
import { runMigrations } from './db/migrate.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.databaseFile);

  const migration = runMigrations(db, config.migrationsDir, (message) =>
    // eslint-disable-next-line no-console -- the logger does not exist yet
    console.log(`[arrranger] ${message}`),
  );

  const app = await buildApp({ config, db });
  app.log.info(
    {
      configDir: config.configDir,
      databaseFile: config.databaseFile,
      schemaVersion: migration.schemaVersion,
      migrationsApplied: migration.applied.length,
      webRoot: config.webRoot,
    },
    'arrranger starting',
  );

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    void app
      .close()
      .catch((error: unknown) => app.log.error({ err: error }, 'error closing server'))
      .finally(() => {
        closeDatabase(db);
        process.exit(0);
      });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  console.error('[arrranger] fatal startup error', error);
  process.exit(1);
});
