import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import BaseCheckbox from './BaseCheckbox.vue';

/**
 * The contract here is not "a checkbox works" - it is the three things 21 call sites and
 * six test files quietly depend on: exactly one real input, the input written first so
 * `peer-*` can reach the drawn box, and a `change` that fires even when the value did
 * not move.
 */
describe('BaseCheckbox', () => {
  it('keeps exactly one native input, first, and puts the test id on it', () => {
    const wrapper = mount(BaseCheckbox, { attrs: { 'data-testid': 'pick' } });

    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(1);
    // `peer-*` compiles to a sibling selector: the input must precede the drawn box.
    expect(wrapper.element.children[0]?.tagName).toBe('INPUT');
    expect(wrapper.find('[data-testid="pick"]').element.tagName).toBe('INPUT');
    expect(wrapper.attributes('data-testid')).toBeUndefined();
  });

  it('round-trips v-model', async () => {
    const wrapper = mount(BaseCheckbox, { props: { modelValue: false } });

    await wrapper.find('input').setValue(true);
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true]);

    await wrapper.setProps({ modelValue: true });
    expect(wrapper.find('input').element.checked).toBe(true);
    expect(wrapper.find('[data-icon="check"]').exists()).toBe(true);
  });

  /**
   * The matrix headers dispatch `change` without flipping `checked` first, and their
   * handlers take no payload. `defineModel` swallows a set that does not change the
   * value, so `change` has to be emitted outside that guard or select-all silently stops
   * working in tests while still working in a browser.
   */
  it('emits change even when the value did not move', async () => {
    const wrapper = mount(BaseCheckbox, { props: { modelValue: false } });

    await wrapper.find('input').trigger('change');

    expect(wrapper.emitted('change')).toHaveLength(1);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('shows a dash rather than a tick while indeterminate', () => {
    const wrapper = mount(BaseCheckbox, { props: { modelValue: false, indeterminate: true } });

    expect(wrapper.find('input').element.indeterminate).toBe(true);
    expect(wrapper.find('[data-icon="remove"]').exists()).toBe(true);
    expect(wrapper.find('[data-icon="check"]').exists()).toBe(false);
  });

  it('disables the input itself, not a wrapper', () => {
    const wrapper = mount(BaseCheckbox, { props: { disabled: true } });

    expect(wrapper.find('input').element.disabled).toBe(true);
  });

  /**
   * `tone` and the attrs split are API surface rather than appearance - a caller cannot
   * check either any other way, and getting the class onto the wrong node is silent.
   */
  it('carries the danger tone into the drawn box', () => {
    const wrapper = mount(BaseCheckbox, { props: { modelValue: true, tone: 'danger' } });

    expect(wrapper.find('[aria-hidden="true"]').classes()).toContain('bg-danger');
  });

  it('routes a caller class to the wrapper, where layout can act on it', () => {
    const wrapper = mount(BaseCheckbox, { attrs: { class: 'mt-0.5' } });

    expect(wrapper.classes()).toContain('mt-0.5');
    expect(wrapper.find('input').classes()).not.toContain('mt-0.5');
  });
});
