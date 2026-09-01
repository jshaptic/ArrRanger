<template>
  <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted">
    <span class="flex items-center gap-1.5">
      <span class="h-2.5 w-2.5 rounded-sm border border-sync/50 bg-sync/20" />
      present
    </span>
    <span class="flex items-center gap-1.5">
      <span class="h-2.5 w-2.5 rounded-sm border border-dashed border-line-strong" />
      missing
    </span>
    <span class="flex items-center gap-1.5">
      <span class="h-2.5 w-2.5 rounded-sm border border-drift/50 bg-drift/20" />
      drift / inaccessible
    </span>
    <span class="flex items-center gap-1.5">
      <span class="h-2.5 w-2.5 rounded-sm border border-staged/60 bg-staged/20" />
      staged change
    </span>
    <span class="flex items-center gap-1.5">
      <span class="h-2.5 w-2.5 rounded-sm border border-danger/50 bg-danger/20" />
      unreachable instance
    </span>
    <span class="ml-auto hidden sm:inline">click a cell to stage a change on that instance</span>
  </div>
</template>
