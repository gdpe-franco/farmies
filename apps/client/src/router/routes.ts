import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', component: () => import('../pages/IndexPage.vue') },
  { path: '/invite/:token', component: () => import('../pages/IndexPage.vue') },
]

export default routes
