import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/tags' },
  {
    path: '/tags',
    name: 'tags',
    component: () => import('@/views/TagMatrixView.vue'),
    meta: { title: 'Tag parity matrix', hint: 'every tag, every instance, side by side' },
  },
  {
    path: '/root-folders',
    name: 'root-folders',
    component: () => import('@/views/RootFolderTopologyView.vue'),
    meta: { title: 'Root folder topology', hint: 'paths, free space and mount-point drift' },
  },
  {
    path: '/import-lists',
    name: 'import-lists',
    component: () => import('@/views/ImportListFleetView.vue'),
    meta: { title: 'Import list fleet', hint: 'compare and align list settings' },
  },
  {
    path: '/storage',
    name: 'storage',
    component: () => import('@/views/StorageExplorerView.vue'),
    meta: { title: 'Storage', hint: 'folders on disk, and what *Arr thinks of them' },
  },
  {
    path: '/queue',
    name: 'queue',
    component: () => import('@/views/QueueView.vue'),
    meta: { title: 'Pending fleet changes', hint: 'review, reorder and apply' },
  },
  {
    path: '/instances',
    name: 'instances',
    component: () => import('@/views/InstancesView.vue'),
    meta: { title: 'Instances', hint: 'connections and health' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/tags' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    hint?: string;
  }
}
