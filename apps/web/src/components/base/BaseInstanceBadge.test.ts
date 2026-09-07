import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import BaseInstanceBadge from './BaseInstanceBadge.vue';

/**
 * Half of these are not testing that a badge renders - they test that "what colour is
 * Sonarr" keeps exactly one answer. It had four before this component existed, which is
 * the kind of drift that never announces itself.
 */

const here = dirname(fileURLToPath(import.meta.url));
const thisFile = fileURLToPath(import.meta.url);
const srcRoot = join(here, '..', '..');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function offenders(pattern: RegExp, allowed: readonly string[]): string[] {
  return walk(srcRoot)
    .filter((file) => /\.(vue|ts)$/.test(file))
    .filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map((file) => relative(srcRoot, file))
    .filter((file) => !allowed.includes(file));
}

describe('the badge boundary', () => {
  /**
   * The nine hand-rolled squares this replaced all started as one `initialsOf` call in a
   * `<span>`. Nothing stops the tenth except this.
   */
  it('turns a name into initials in the badge and nowhere else', () => {
    const allowed = [
      join('components', 'base', 'BaseInstanceBadge.vue'),
      join('lib', 'format.ts'),
      relative(srcRoot, thisFile),
    ];

    expect(offenders(/\binitialsOf\b/, allowed)).toEqual([]);
  });

  /**
   * The fleet bar, the matrix header and the instances table each carried their own
   * `kind === 'radarr' ? amber : sky`, and `lib/path-matrix` exported a fourth copy for
   * the chips - an instance colour parked in the module that computes folder ownership.
   */
  it('keeps the per-app palette in the badge and nowhere else', () => {
    const allowed = [
      join('components', 'base', 'BaseInstanceBadge.vue'),
      relative(srcRoot, thisFile),
    ];

    expect(offenders(/amber-500\/20|sky-500\/20/, allowed)).toEqual([]);
  });
});

describe('the square', () => {
  const SIZES = [
    ['sm', 'h-4', 'w-4'],
    ['md', 'h-5', 'w-5'],
    ['lg', 'h-6', 'w-6'],
  ] as const;

  it.each(SIZES)('size=%s emits exactly one height and one width', (size, h, w) => {
    const classes = mount(BaseInstanceBadge, {
      props: { name: 'Radarr-4K', kind: 'radarr', size },
    }).classes();

    expect(classes.filter((c) => c.startsWith('h-'))).toEqual([h]);
    expect(classes.filter((c) => c.startsWith('w-'))).toEqual([w]);
  });

  it('colours by app, not by state', () => {
    const radarr = mount(BaseInstanceBadge, { props: { name: 'Films', kind: 'radarr' } });
    const sonarr = mount(BaseInstanceBadge, { props: { name: 'Films', kind: 'sonarr' } });

    expect(radarr.classes()).not.toEqual(sonarr.classes());
    expect(radarr.text()).toBe(sonarr.text());
  });

  /** The matrix header's rule, moved here so no other caller can invent a second one. */
  it('lets an unreachable instance override its app colour, and only it', () => {
    const fill = (tone: 'kind' | 'error') =>
      mount(BaseInstanceBadge, { props: { name: 'Films', kind: 'radarr', tone } })
        .classes()
        .filter((c) => c.startsWith('bg-'));

    expect(fill('error')).toEqual(['bg-danger/20']);
    expect(fill('error')).not.toEqual(fill('kind'));
  });

  /** Local storage owns queue work but is not an *Arr app, so it gets no app colour. */
  it('reads local storage as FS with no app colour', () => {
    const wrapper = mount(BaseInstanceBadge, { props: { name: null } });

    expect(wrapper.text()).toBe('FS');
    expect(wrapper.classes().join(' ')).not.toContain('amber');
    expect(wrapper.classes().join(' ')).not.toContain('sky');
  });
});

describe('the muted tone', () => {
  /**
   * The queue and staging lists spell the instance name out beside the initials; a
   * coloured tile on every row would compete with the status chips that carry the meaning.
   */
  it('drops the box but keeps the text scale', () => {
    const classes = mount(BaseInstanceBadge, {
      props: { name: 'Radarr-4K', kind: 'radarr', tone: 'muted' },
    }).classes();

    expect(classes.filter((c) => /^[hw]-/.test(c))).toEqual([]);
    expect(classes).toContain('text-[10px]');
    expect(classes).toContain('text-faint');
    expect(classes.join(' ')).not.toContain('amber');
  });

  it('derives its initials the same way the square does', () => {
    const props = { name: 'Radarr 4K' } as const;

    expect(mount(BaseInstanceBadge, { props: { ...props, tone: 'muted' } }).text()).toBe(
      mount(BaseInstanceBadge, { props }).text(),
    );
  });
});

describe('the marker', () => {
  it('tags itself so a test can ask for "the instance", not a span', () => {
    expect(
      mount(BaseInstanceBadge, { props: { name: 'Films', kind: 'radarr' } }).attributes(),
    ).toHaveProperty('data-instance-badge');
  });
});
