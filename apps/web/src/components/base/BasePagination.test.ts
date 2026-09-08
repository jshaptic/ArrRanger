import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import BasePagination from './BasePagination.vue';
import { pageItems } from './pagination';

describe('pageItems', () => {
  it('lists every page when there are few', () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('keeps the ends and the neighbours, and gaps the rest', () => {
    expect(pageItems(5, 12)).toEqual([1, 'gap', 4, 5, 6, 'gap', 12]);
  });

  it('does not gap next to the first or last page', () => {
    expect(pageItems(1, 12)).toEqual([1, 2, 3, 4, 'gap', 12]);
    expect(pageItems(12, 12)).toEqual([1, 'gap', 9, 10, 11, 12]);
  });

  it('returns nothing for an empty listing', () => {
    expect(pageItems(1, 0)).toEqual([]);
  });
});

describe('BasePagination', () => {
  it('disables Previous on the first page and Next on the last', () => {
    const first = mount(BasePagination, { props: { page: 1, totalPages: 4 } });
    expect(first.find('[data-testid="page-prev"]').attributes('disabled')).toBeDefined();
    expect(first.find('[data-testid="page-next"]').attributes('disabled')).toBeUndefined();

    const last = mount(BasePagination, { props: { page: 4, totalPages: 4 } });
    expect(last.find('[data-testid="page-prev"]').attributes('disabled')).toBeUndefined();
    expect(last.find('[data-testid="page-next"]').attributes('disabled')).toBeDefined();
  });

  it('marks the current page and emits a different one', async () => {
    const wrapper = mount(BasePagination, { props: { page: 5, totalPages: 12 } });

    expect(wrapper.find('[data-testid="page-5"]').attributes('aria-current')).toBe('page');
    await wrapper.find('[data-testid="page-6"]').trigger('click');
    expect(wrapper.emitted('page')?.[0]).toEqual([6]);

    await wrapper.find('[data-testid="page-5"]').trigger('click');
    expect(wrapper.emitted('page')).toHaveLength(1);
  });

  it('does not emit while loading', async () => {
    const wrapper = mount(BasePagination, { props: { page: 2, totalPages: 4, loading: true } });

    await wrapper.find('[data-testid="page-next"]').trigger('click');
    expect(wrapper.emitted('page')).toBeUndefined();
  });
});
