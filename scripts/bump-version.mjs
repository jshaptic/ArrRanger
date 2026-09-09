#!/usr/bin/env node
/**
 * Keep every workspace on one version. package.json is the last *released*
 * version only - CI never commits a hash. The Docker workflow is the writer;
 * run this locally only to preview a bump.
 *
 *   node scripts/bump-version.mjs patch|minor|major
 *   node scripts/bump-version.mjs 1.2.3
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_FILES = [
  'package.json',
  'apps/server/package.json',
  'apps/web/package.json',
  'packages/shared/package.json',
];

const spec = process.argv[2];
if (spec === undefined || spec.length === 0) {
  console.error('usage: node scripts/bump-version.mjs <patch|minor|major|x.y.z>');
  process.exit(1);
}

function readJson(relative) {
  return JSON.parse(readFileSync(path.join(ROOT, relative), 'utf8'));
}

function writeJson(relative, value) {
  writeFileSync(path.join(ROOT, relative), `${JSON.stringify(value, null, 2)}\n`);
}

function bump(current, kind) {
  const parts = current.split('.').map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`Cannot bump "${current}": expected x.y.z`);
  }
  const [major, minor, patch] = parts;
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown bump "${kind}"`);
}

const current = readJson('package.json').version;
if (typeof current !== 'string' || current.length === 0) {
  throw new Error('root package.json has no version');
}

const next = /^\d+\.\d+\.\d+$/.test(spec) ? spec : bump(current, spec);

for (const relative of PACKAGE_FILES) {
  const pkg = readJson(relative);
  pkg.version = next;
  if (pkg.dependencies?.['@fleetarr/shared'] !== undefined) {
    pkg.dependencies['@fleetarr/shared'] = `^${next}`;
  }
  writeJson(relative, pkg);
}

const lock = spawnSync('npm', ['install', '--package-lock-only', '--ignore-scripts'], {
  cwd: ROOT,
  stdio: 'inherit',
});
if (lock.status !== 0) {
  process.exit(lock.status ?? 1);
}

process.stdout.write(`${next}\n`);
