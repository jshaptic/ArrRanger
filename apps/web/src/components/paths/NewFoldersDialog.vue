<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { FsPreflight, NewFsQueueItem } from '@arrranger/shared';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseModal from '@/components/base/BaseModal.vue';
import { planNewFolders } from '@/lib/new-folders';
import { usePathsStore } from '@/stores/paths';
import { useQueueStore } from '@/stores/queue';

/**
 * One box for every folder about to exist.
 *
 * This replaced a `new folder` button on every row. The row version could only ever create
 * one folder in one place, so laying out a library meant repeating it - while the shape
 * people actually describe is `{movies,series}/{russian,western}/4k`, said once. The box
 * therefore speaks the same brace expansion the filter does (see `planNewFolders`), and the
 * preview below it is the list of paths that will be staged, not a promise about them.
 *
 * Preflight is per folder and the server's answer, so it is asked once the typing settles
 * and only for the first {@link PREFLIGHT_LIMIT}: a brace tree can name hundreds, and every
 * item's preflight runs again immediately before it executes anyway.
 */
const props = withDefaults(
  defineProps<{
    /** Where relative patterns land. Editable here - the view only chooses the first guess. */
    parent: string;
    /** A folder name to start from, for repairing a path only *Arr believes in. */
    source?: string;
  }>(),
  { source: '' },
);
const emit = defineEmits<{ close: [] }>();

const fs = usePathsStore();
const queue = useQueueStore();

const PREFLIGHT_LIMIT = 40;
/** Long enough that a brace tree is typed, not asked about halfway through. */
const SETTLE_MS = 350;

const parent = ref(props.parent);
const draft = ref(props.source);
const recursive = ref(true);
const skipExisting = ref(true);
const showHelp = ref(false);

const plan = computed(() => planNewFolders(parent.value, draft.value));

// ------------------------------------------------------------ the parent picker

/**
 * "Create in" is a combobox, not a `<datalist>`.
 *
 * A datalist filters its options by what is already in the field, and this field opens
 * pre-filled with the folder you had selected - so the list it offered was reliably empty,
 * which is no list at all. This one opens on the caret, lists every directory the tree has
 * actually read (see `knownDirectories`), narrows as you type, and never stands in the way
 * of typing a path it has never heard of: the preflight is what says whether a path is real.
 */
const open = ref(false);
/** What has been typed since the list was opened, or null while it is showing everything. */
const query = ref<string | null>(null);
const highlight = ref(0);

const suggestions = computed(() => {
  const needle = query.value?.trim().toLowerCase() ?? '';
  const all = fs.knownDirectories;
  return needle.length === 0 ? all : all.filter((path) => path.toLowerCase().includes(needle));
});

function openPicker(): void {
  open.value = !open.value;
  query.value = null;
  highlight.value = 0;
}

function onParentInput(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  parent.value = value;
  query.value = value;
  open.value = true;
  highlight.value = 0;
}

function pick(path: string): void {
  parent.value = path;
  open.value = false;
  query.value = null;
}

/** Arrow keys walk the list, Enter takes the highlighted row, Escape closes only the list. */
function onParentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && open.value) {
    event.stopPropagation();
    open.value = false;
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!open.value) {
      open.value = true;
      query.value = null;
      return;
    }
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const count = suggestions.value.length;
    if (count > 0) highlight.value = (highlight.value + step + count) % count;
    return;
  }
  if (event.key === 'Enter' && open.value) {
    event.preventDefault();
    const chosen = suggestions.value[highlight.value];
    if (chosen !== undefined) pick(chosen);
  }
}

// ------------------------------------------------------------------- preflight

const checks = ref<ReadonlyMap<string, FsPreflight>>(new Map());
const checking = ref(false);
/** The plan the current `checks` describe, so a stale answer is never read as this one. */
const checkedFor = ref<string | null>(null);

let sequence = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

/** The folders actually asked about: the rest are checked by the queue as they run. */
const checkable = computed(() => plan.value.targets.slice(0, PREFLIGHT_LIMIT));
const unchecked = computed(() => plan.value.targets.length - checkable.value.length);

/** The key a set of answers belongs to - the paths, and the flag that changes the verdict. */
const planKey = computed(() => `${String(recursive.value)} ${plan.value.targets.join(' ')}`);

async function preflightOne(path: string): Promise<FsPreflight> {
  try {
    return await fs.preflight('fs.mkdir', { path, recursive: recursive.value });
  } catch (error) {
    return {
      op: 'fs.mkdir',
      ok: false,
      checks: [
        {
          id: 'request_failed',
          status: 'blocker',
          message: error instanceof Error ? error.message : 'Preflight failed',
        },
      ],
      measurement: null,
      freeSpace: null,
      referencedBy: [],
    };
  }
}

async function check(): Promise<void> {
  const mine = ++sequence;
  const targets = checkable.value;
  const key = planKey.value;

  if (targets.length === 0) {
    checks.value = new Map();
    checkedFor.value = plan.value.error === null ? key : null;
    checking.value = false;
    return;
  }

  checking.value = true;
  const answers = await Promise.all(
    targets.map(async (path) => [path, await preflightOne(path)] as const),
  );
  if (mine !== sequence) return;

  checks.value = new Map(answers);
  checkedFor.value = key;
  checking.value = false;
}

function schedule(): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => void check(), SETTLE_MS);
}

onMounted(() => void check());
onUnmounted(() => {
  if (timer !== null) clearTimeout(timer);
});
watch(planKey, schedule);

// ------------------------------------------------------------------- verdicts

function blockersOf(path: string): string[] {
  const answer = checks.value.get(path);
  if (answer === undefined) return [];
  return answer.checks.filter((entry) => entry.status === 'blocker').map((entry) => entry.message);
}

/** `destination_free` is the one blocker a batch can reasonably shrug off - see `skipExisting`. */
function alreadyExists(path: string): boolean {
  const answer = checks.value.get(path);
  return (
    answer?.checks.some((entry) => entry.id === 'destination_free' && entry.status === 'blocker') ===
    true
  );
}

/** True while `checks` describes the plan on screen rather than the one before it. */
const fresh = computed(() => checkedFor.value === planKey.value);
const existing = computed(() => (fresh.value ? checkable.value.filter(alreadyExists) : []));

/** What the Stage button would create: the plan, minus the ones being skipped. */
const staging = computed(() =>
  skipExisting.value && existing.value.length > 0
    ? plan.value.targets.filter((path) => !existing.value.includes(path))
    : plan.value.targets,
);

/** A folder that cannot be created and is not being skipped - the reason to hold the button. */
const blocked = computed(() =>
  !fresh.value
    ? []
    : staging.value
        .map((path) => ({ path, reasons: blockersOf(path) }))
        .filter((entry) => entry.reasons.length > 0),
);

const warnings = computed(() => {
  const messages = new Set<string>();
  for (const path of staging.value) {
    for (const entry of checks.value.get(path)?.checks ?? []) {
      if (entry.status === 'warning') messages.add(entry.message);
    }
  }
  return [...messages];
});

const canStage = computed(
  () =>
    plan.value.error === null &&
    staging.value.length > 0 &&
    blocked.value.length === 0 &&
    fresh.value &&
    !checking.value &&
    !queue.busy,
);

async function stage(): Promise<void> {
  const targets = staging.value;
  if (targets.length === 0) return;

  const items = targets.map(
    (path): NewFsQueueItem => ({ op: 'fs.mkdir', payload: { path, recursive: recursive.value } }),
  );

  await queue.stage(
    items,
    targets.length === 1
      ? `a new directory ${targets[0] ?? ''}`
      : `${String(targets.length)} new directories`,
  );
  emit('close');
}
</script>

<template>
  <BaseModal
    title="New folder(s)"
    subtitle="One name, or a brace tree - the same syntax mkdir -p takes"
    width="lg"
    @close="emit('close')"
  >
    <div class="space-y-4">
      <div class="relative">
        <label class="mb-1 block text-xs text-muted" for="new-folders-parent">Create in</label>
        <input
          id="new-folders-parent"
          :value="parent"
          type="text"
          role="combobox"
          spellcheck="false"
          autocomplete="off"
          aria-controls="new-folders-parent-list"
          :aria-expanded="open"
          data-testid="new-folders-parent"
          class="w-full rounded-md border border-line bg-raised px-3 py-2 pr-9 font-mono text-sm text-ink outline-none focus:border-accent"
          @input="onParentInput"
          @keydown="onParentKeydown"
          @blur="open = false"
        />
        <button
          type="button"
          class="absolute right-1 bottom-0 flex h-[38px] w-7 items-center justify-center text-xs transition-colors"
          :class="open ? 'text-accent' : 'text-faint hover:text-ink'"
          :aria-expanded="open"
          :title="`Pick from the ${fs.knownDirectories.length} folder(s) this view has read`"
          data-testid="new-folders-parent-toggle"
          @mousedown.prevent="openPicker"
        >
          ▾
        </button>

        <ul
          v-if="open"
          id="new-folders-parent-list"
          role="listbox"
          class="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-line bg-overlay py-1 shadow-xl"
          data-testid="new-folders-parent-list"
        >
          <li
            v-for="(path, index) in suggestions"
            :key="path"
            role="option"
            :aria-selected="path === parent"
            class="cursor-pointer px-3 py-1 font-mono text-[11px]"
            :class="[
              index === highlight ? 'bg-raised text-ink' : 'text-muted',
              path === parent ? 'text-accent' : '',
            ]"
            @mouseenter="highlight = index"
            @mousedown.prevent="pick(path)"
          >
            {{ path }}
          </li>
          <li v-if="suggestions.length === 0" class="px-3 py-1 text-[11px] text-faint">
            No folder read so far matches - type the path and the preflight will check it
          </li>
        </ul>
      </div>

      <div>
        <div class="mb-1 flex items-center justify-between">
          <span class="text-xs text-muted">Folder(s)</span>
          <button
            type="button"
            class="text-[11px] transition-colors"
            :class="showHelp ? 'text-accent' : 'text-faint hover:text-ink'"
            :aria-expanded="showHelp"
            title="mkdir syntax"
            @click="showHelp = !showHelp"
          >
            syntax ?
          </button>
        </div>
        <input
          v-model="draft"
          type="text"
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          data-testid="new-folders-input"
          placeholder="movies-4k, or {movies,series}/{russian,western}/4k"
          class="w-full rounded-md border bg-raised px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
          :class="plan.error === null ? 'border-line' : 'border-danger/60'"
          @keydown.enter.prevent="canStage && stage()"
        />
        <p
          v-if="plan.error !== null"
          class="mt-1 text-[11px] text-danger"
          data-testid="new-folders-error"
        >
          ⚠ {{ plan.error }} - nothing will be created
        </p>
      </div>

      <div
        v-if="showHelp"
        class="rounded-md border border-line bg-raised/60 p-2 text-[11px] leading-relaxed text-muted"
      >
        <dl class="grid gap-x-3 gap-y-1 sm:grid-cols-[12rem_1fr]">
          <dt class="font-mono text-ink">movies-4k</dt>
          <dd>one folder, in the directory above</dd>
          <dt class="font-mono text-ink">{movies,series}/4k</dt>
          <dd>both of them, each with a <span class="font-mono">4k</span> inside</dd>
          <dt class="font-mono text-ink">season{01..12}</dt>
          <dd>ranges, zero-padded when you pad the first one</dd>
          <dt class="font-mono text-ink">"TV Shows"</dt>
          <dd>quote (or backslash-escape) a space or a brace</dd>
          <dt class="font-mono text-ink">a b</dt>
          <dd>a space separates folders, exactly like arguments to mkdir</dd>
          <dt class="font-mono text-ink">/data/other/4k</dt>
          <dd>a leading slash ignores the directory above and is taken as written</dd>
        </dl>
      </div>

      <label class="flex items-start gap-2 text-xs text-muted">
        <input v-model="recursive" type="checkbox" class="mt-0.5 accent-[var(--color-accent)]" />
        <span>
          <span class="font-medium text-ink">Create parent directories as needed</span>
          <span class="block text-[11px]">
            <span class="font-mono">mkdir -p</span>
            <template v-if="plan.nested">
              - required here: these patterns name more than one level
            </template>
          </span>
        </span>
      </label>

      <!-- the plan: the paths themselves, because a count is not a review -->
      <div
        v-if="plan.targets.length > 0"
        class="rounded-lg border border-line bg-raised/40 px-3 py-2.5"
      >
        <p class="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-muted">
          <span data-testid="new-folders-count">{{ plan.targets.length }} folder(s)</span>
          <span v-if="checking" class="text-faint">preflighting…</span>
          <span v-else-if="blocked.length > 0" class="text-danger">
            {{ blocked.length }} cannot be created
          </span>
          <span v-else-if="fresh && staging.length > 0" class="text-sync">all checks passed</span>
          <span v-if="unchecked > 0" class="font-normal text-faint">
            - the first {{ PREFLIGHT_LIMIT }} were checked; the rest are checked as they run
          </span>
        </p>

        <ul
          class="max-h-56 space-y-0.5 overflow-y-auto font-mono text-[11px]"
          data-testid="new-folders-preview"
        >
          <li
            v-for="target in plan.targets"
            :key="target"
            class="flex gap-2"
            :class="
              existing.includes(target)
                ? skipExisting
                  ? 'text-faint line-through'
                  : 'text-danger'
                : blockersOf(target).length > 0
                  ? 'text-danger'
                  : 'text-muted'
            "
          >
            <span class="w-3 shrink-0">
              <template v-if="existing.includes(target)">{{ skipExisting ? '·' : '✕' }}</template>
              <template v-else-if="blockersOf(target).length > 0">✕</template>
              <template v-else-if="checks.has(target)">✓</template>
              <template v-else>+</template>
            </span>
            <span class="truncate" :title="blockersOf(target).join('; ') || target">
              {{ target }}
            </span>
          </li>
        </ul>

        <label
          v-if="existing.length > 0"
          class="mt-2 flex items-center gap-2 text-[11px] text-muted"
          data-testid="new-folders-skip-existing"
        >
          <input v-model="skipExisting" type="checkbox" class="accent-[var(--color-accent)]" />
          Skip the {{ existing.length }} that already exist
        </label>

        <ul v-if="blocked.length > 0" class="mt-2 space-y-1 text-[11px] text-danger">
          <li v-for="entry in blocked" :key="entry.path" class="flex gap-2">
            <span>✕</span>
            <span>
              <span class="font-mono">{{ entry.path }}</span> - {{ entry.reasons.join('; ') }}
            </span>
          </li>
        </ul>
        <ul v-if="warnings.length > 0" class="mt-2 space-y-1 text-[11px] text-drift">
          <li v-for="message in warnings" :key="message" class="flex gap-2">
            <span>⚠</span>
            <span>{{ message }}</span>
          </li>
        </ul>
      </div>

      <p class="text-[11px] leading-relaxed text-muted">
        Nothing happens now: each folder is added to Pending Fleet Changes as its own step, and
        its preflight runs again immediately before it executes.
      </p>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
      <BaseButton
        variant="primary"
        :disabled="!canStage"
        :loading="queue.busy"
        data-testid="new-folders-stage"
        @click="stage()"
      >
        Stage {{ staging.length > 0 ? `${staging.length} ` : '' }}mkdir
      </BaseButton>
    </template>
  </BaseModal>
</template>
