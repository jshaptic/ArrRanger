import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import BaseIcon, { type IconSize } from './BaseIcon.vue';
import IconCheck from './IconCheck.vue';
import IconError from './IconError.vue';
import IconWarning from './IconWarning.vue';
import * as glyphs from './glyphs';

/**
 * These checks are the reason the icon layer is three files instead of one. Most of them
 * are not testing that an icon draws - they test that swapping the icon library stays a
 * one-file change and that size stays a prop, which are the kinds of property that rot
 * silently the moment nobody is watching.
 */

const here = dirname(fileURLToPath(import.meta.url));
const thisFile = fileURLToPath(import.meta.url);
const srcRoot = join(here, '..', '..', '..');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const wrapperFiles = readdirSync(here).filter((f) => f.startsWith('Icon') && f.endsWith('.vue'));
const SIZE_CLASSES: ReadonlyArray<readonly [IconSize, string]> = [
  ['xs', 'h-3'],
  ['sm', 'h-3.5'],
  ['md', 'h-4'],
  ['lg', 'h-4.5'],
  ['xl', 'h-6'],
  ['2xl', 'h-7'],
];

describe('the library boundary', () => {
  /**
   * Without this the next person imports `RiAddLine` straight into a dialog, nobody
   * notices for a year, and "rewrite glyphs.ts" quietly becomes "grep the whole app".
   */
  it('names an icon library in glyphs.ts and nowhere else', () => {
    // The adapter, and this file - which cannot look for the name without saying it.
    const allowed = [join('components', 'base', 'icons', 'glyphs.ts'), relative(srcRoot, thisFile)];
    const offenders = walk(srcRoot)
      .filter((file) => /\.(vue|ts)$/.test(file))
      .filter((file) => readFileSync(file, 'utf8').includes('@remixicon'))
      .map((file) => relative(srcRoot, file))
      .filter((file) => !allowed.includes(file));

    expect(offenders).toEqual([]);
  });

  it('pairs every glyph with exactly one wrapper', () => {
    const fromFiles = wrapperFiles.map((f) => `${f.slice('Icon'.length, -'.vue'.length)}Glyph`).sort();

    expect(fromFiles).toEqual(Object.keys(glyphs).sort());
  });

  it('gives every glyph an outline, and a solid or nothing at all', () => {
    for (const [name, entry] of Object.entries(glyphs)) {
      expect(entry.outline, name).toBeTruthy();
      if ('solid' in entry) expect(entry.solid, name).toBeTruthy();
    }
  });

  /**
   * The swap contract, stated as an assertion: a drawing is a component rendering a
   * single-root <svg> that merges a fall-through class. Nothing else about the library is
   * used, so a replacement satisfying this needs no change beyond glyphs.ts. Both weights
   * are covered - a set whose Fill half breaks the contract should fail here, not the
   * first time somebody writes variant="solid".
   */
  const drawings = Object.entries(glyphs).flatMap(([name, entry]) =>
    entry.solid
      ? ([
          [`${name}.outline`, entry.outline],
          [`${name}.solid`, entry.solid],
        ] as const)
      : ([[`${name}.outline`, entry.outline]] as const),
  );

  it.each(drawings)('%s renders a single svg root that takes a class', (_name, drawing) => {
    const wrapper = mount(drawing, { attrs: { class: 'h-3 w-3' } });

    expect(wrapper.element.tagName.toLowerCase()).toBe('svg');
    expect(wrapper.classes()).toContain('h-3');
  });
});

describe('BaseIcon sizing', () => {
  it.each(SIZE_CLASSES)('size=%s renders %s', (size, expected) => {
    const wrapper = mount(BaseIcon, { props: { glyph: glyphs.WarningGlyph, size } });

    expect(wrapper.classes()).toContain(expected);
  });

  /**
   * The descendant of "leaves sizing to the caller". That rule was "BaseIcon must carry no
   * `h-*`", because sizing was a class racing other classes and an em-valued default
   * beat every caller's `h-3` by emit order, silently. A prop decides now, so the rule
   * becomes "exactly one" - two would still be settled by emit order rather than intent.
   */
  it.each(SIZE_CLASSES)('size=%s emits exactly one height and one width', (size) => {
    const wrapper = mount(BaseIcon, { props: { glyph: glyphs.WarningGlyph, size } });

    expect(wrapper.classes().filter((c) => c.startsWith('h-'))).toHaveLength(1);
    expect(wrapper.classes().filter((c) => c.startsWith('w-'))).toHaveLength(1);
  });

  /**
   * The other half of that warning, restated for a prop-driven table. Tailwind emits
   * arbitrary values after fixed ones, so one bracketed entry in SIZES would outrank every
   * other entry in the same table - a token silently ignoring five of the six sizes.
   * Nothing about a prop prevents that; only this does.
   */
  it.each(SIZE_CLASSES)('size=%s sizes from the fixed scale, never an arbitrary value', (size) => {
    const wrapper = mount(BaseIcon, { props: { glyph: glyphs.WarningGlyph, size } });

    expect(wrapper.classes().filter((c) => /^[hw]-/.test(c)).join(' ')).not.toContain('[');
  });

  it('keeps the app-icon marker, the only selector meaning "any icon"', () => {
    expect(mount(BaseIcon, { props: { glyph: glyphs.CheckGlyph } }).classes()).toContain('app-icon');
  });

  it('hides itself from assistive tech and sizes the drawing to its own box', () => {
    const wrapper = mount(BaseIcon, { props: { glyph: glyphs.WarningGlyph } });

    expect(wrapper.attributes('aria-hidden')).toBe('true');
    expect(wrapper.find('svg').classes()).toContain('h-full');
  });
});

describe('BaseIcon weight', () => {
  it('draws something different for solid than for outline', () => {
    const outline = mount(BaseIcon, { props: { glyph: glyphs.WarningGlyph } });
    const solid = mount(BaseIcon, { props: { glyph: glyphs.WarningGlyph, variant: 'solid' } });

    expect(solid.find('svg').html()).not.toBe(outline.find('svg').html());
  });

  /** The glyphs with no filled twin must still draw, not blank. */
  it.each(Object.entries(glyphs).filter(([, entry]) => !entry.solid))(
    '%s falls back to its outline when asked for solid',
    (_name, glyph) => {
      const outline = mount(BaseIcon, { props: { glyph } });
      const solid = mount(BaseIcon, { props: { glyph, variant: 'solid' } });

      expect(solid.find('svg').html()).toBe(outline.find('svg').html());
    },
  );
});

describe('the wrappers', () => {
  /**
   * The 36 are the same handful of lines modulo two tokens. Asserting the shape rather
   * than the filename is what makes that much boilerplate safe: a half-finished migration,
   * a wrapper that forgot `v-bind="props"`, a `data-icon` drifted from its filename - all
   * fail here, naming the file. Comments are stripped first, so prose can be edited freely.
   */
  it.each(wrapperFiles)('%s has the standard wrapper shape', (file) => {
    const name = file.slice('Icon'.length, -'.vue'.length);
    const icon = name.replace(/(?!^)(?=[A-Z])/g, '-').toLowerCase();
    const source = readFileSync(join(here, file), 'utf8')
      .replace(/\/\*\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .trim();

    expect(source).toContain(`import { ${name}Glyph } from './glyphs';`);
    expect(source).toContain(`import BaseIcon, { type IconProps } from './BaseIcon.vue';`);
    expect(source).toMatch(/defineProps<IconProps>\(\)/);
    expect(source).toContain(`<BaseIcon v-bind="props" :glyph="${name}Glyph" data-icon="${icon}" />`);
  });

  it('forwards size through a wrapper to BaseIcon', () => {
    expect(mount(IconWarning, { props: { size: 'xs' } }).classes()).toContain('h-3');
  });

  it('falls back to the shared default when a wrapper is given nothing', () => {
    expect(mount(IconCheck).classes()).toContain('h-4');
  });

  /**
   * The `[data-icon]` CSS rule this replaced, restated where a reader will hit it: the
   * light triangle and the solid circle share the severity column and must not share a
   * box size, or the pair reads backwards.
   */
  it('draws the optically light warning larger than the dense error', () => {
    expect(mount(IconWarning).classes()).toContain('h-4.5');
    expect(mount(IconError).classes()).toContain('h-3');
    expect(mount(IconCheck).classes()).toContain('h-4');
  });

  it('lets a caller beat a wrapper default', () => {
    expect(mount(IconError, { props: { size: 'sm' } }).classes()).toContain('h-3.5');
  });

  it('lets a wrapper tag itself so tests can ask for a meaning, not a glyph', () => {
    expect(mount(IconWarning).attributes('data-icon')).toBe('warning');
  });
});

describe('the rules that keep the CSS gone', () => {
  /** 27 components, zero stylesheets. The icon layer was the last thing that might have
   *  wanted one, and it does not. */
  it('has no scoped stylesheet anywhere', () => {
    const offenders = walk(srcRoot)
      .filter((file) => file.endsWith('.vue'))
      .filter((file) => /<style[\s>]/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(srcRoot, file));

    expect(offenders).toEqual([]);
  });

  /**
   * Sizing is the `size` prop. A caller's `h-3` would not error - it would lose to
   * BaseIcon's own `h-4` by Tailwind's emit order and be silently ignored, which is the
   * same failure the old `.app-icon` layering existed to avoid in the other direction.
   */
  it('sizes icons with the prop, never a class', () => {
    const call = /<(?:Icon[A-Za-z]+|component :is="[^"]*")[^>]*class="[^"]*\b[hw]-/;
    const offenders = walk(srcRoot)
      .filter((file) => file.endsWith('.vue') && file !== join(here, 'BaseIcon.vue'))
      .filter((file) => call.test(readFileSync(file, 'utf8')))
      .map((file) => relative(srcRoot, file));

    expect(offenders).toEqual([]);
  });
});
