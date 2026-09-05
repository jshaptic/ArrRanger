import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The bar never talks to the API itself, but the store it drives does.
vi.mock('@/api/storage', () => ({
  storageApi: { matrix: vi.fn(), measure: vi.fn(), preflight: vi.fn(), roots: vi.fn() },
}));

const PathFilterBar = (await import('./PathFilterBar.vue')).default;
const { usePathsStore } = await import('@/stores/paths');

/**
 * Typing, without the blur that applies it: `setValue` in this environment fires `change`
 * too, and half a brace tree must never become a request.
 */
async function type(wrapper: ReturnType<typeof mount>, value: string) {
  const input = wrapper.find('[data-testid="path-filter-input"]');
  (input.element as HTMLInputElement).value = value;
  await input.trigger('input');
  return input;
}

function mountBar() {
  setActivePinia(createPinia());
  const store = usePathsStore();
  const setFilter = vi.spyOn(store, 'setFilter').mockResolvedValue();
  const setFilterMode = vi.spyOn(store, 'setFilterMode').mockResolvedValue();
  const wrapper = mount(PathFilterBar);
  return { wrapper, store, setFilter, setFilterMode };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('PathFilterBar', () => {
  it('says nothing while a brace tree is being typed, and asks for nothing', async () => {
    const { wrapper, setFilter } = mountBar();

    await type(wrapper, '{movies,series}/{4k,main}');

    expect(setFilter).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="path-filter-error"]').exists()).toBe(false);
  });

  it('applies on Enter and clears on Escape', async () => {
    const { wrapper, setFilter } = mountBar();
    const input = await type(wrapper, 'movies/4k');
    await input.trigger('keydown.enter');
    expect(setFilter).toHaveBeenCalledWith('movies/4k');

    await input.trigger('keydown.esc');
    expect(setFilter).toHaveBeenLastCalledWith('');
    expect((input.element as HTMLInputElement).value).toBe('');
  });

  it('explains a filter it cannot read and refuses to ask for it', async () => {
    const { wrapper, setFilter } = mountBar();
    const input = await type(wrapper, 'movies/{4k,main');
    await input.trigger('keydown.enter');

    expect(setFilter).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="path-filter-error"]').text()).toContain('unclosed “{”');
  });

  it('the mode buttons hand the negation to the store', async () => {
    const { wrapper, setFilterMode } = mountBar();
    await type(wrapper, 'movies/4k');

    await wrapper.find('[data-mode="exclude"]').trigger('click');
    expect(setFilterMode).toHaveBeenCalledWith('exclude');
  });

  it('spells the syntax out in the same notation the box takes', async () => {
    const { wrapper } = mountBar();
    await wrapper.find('button[title="Filter syntax"]').trigger('click');

    const help = wrapper.find('[data-testid="path-filter-help"]').text();
    expect(help).toContain('{movies,series}/4k');
    expect(help).toContain('season{01..12}');
  });
});
