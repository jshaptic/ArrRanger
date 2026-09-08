import { onBeforeUnmount, ref, shallowRef } from 'vue';

/** Where a card should sit: the chip's own box, in viewport coordinates. */
export interface HoverAnchor {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
}

export interface OpenHoverCard<T> {
  readonly item: T;
  readonly anchor: HoverAnchor;
}

const HOVER_MS = 160;
const LEAVE_MS = 140;

/**
 * Hover to peek, click to pin.
 *
 * The mechanics behind the chip cards on `/paths` and `/import-lists`, extracted at the
 * point a third view needed them rather than the second - two hand-rolled copies is a
 * coincidence, three is a component. The delays are what stop a card flickering open while
 * the pointer crosses a row of chips on its way somewhere else.
 *
 * The existing two keep their own copies for now: their markup is pinned by tests, and
 * adopting this is a separate change with its own diff to read.
 */
export function useHoverCard<T>() {
  // shallowRef, not ref: the card is replaced wholesale, and deep-unwrapping a generic
  // payload is what makes `ref<T>` lose the caller's type.
  const open = shallowRef<OpenHoverCard<T> | null>(null);
  const pinned = ref(false);

  let openTimer: number | null = null;
  let closeTimer: number | null = null;

  function clearTimers(): void {
    if (openTimer !== null) window.clearTimeout(openTimer);
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    openTimer = null;
    closeTimer = null;
  }

  function anchorOf(event: Event): HoverAnchor {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, left: rect.left };
  }

  function show(item: T, event: Event): void {
    clearTimers();
    open.value = { item, anchor: anchorOf(event) };
  }

  function hover(item: T, event: Event): void {
    clearTimers();
    const anchor = anchorOf(event);
    openTimer = window.setTimeout(() => {
      if (!pinned.value) open.value = { item, anchor };
    }, HOVER_MS);
  }

  function scheduleClose(): void {
    clearTimers();
    if (pinned.value) return;
    closeTimer = window.setTimeout(() => {
      open.value = null;
    }, LEAVE_MS);
  }

  function close(): void {
    clearTimers();
    pinned.value = false;
    open.value = null;
  }

  /** Click: pin it, or unpin when the same chip is clicked again. */
  function toggle(item: T, event: Event, isSame: (candidate: T) => boolean): void {
    if (pinned.value && open.value !== null && isSame(open.value.item)) {
      close();
      return;
    }
    pinned.value = true;
    show(item, event);
  }

  onBeforeUnmount(clearTimers);

  return { open, pinned, show, hover, scheduleClose, close, toggle, clearTimers };
}
