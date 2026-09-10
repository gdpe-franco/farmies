import { defineRouter } from '@quasar/app-vite'
import { createMemoryHistory, createRouter, createWebHistory } from 'vue-router'
import routes from './routes'

export default defineRouter(() =>
  createRouter({
    history: import.meta.env.SSR ? createMemoryHistory() : createWebHistory(),
    routes,
  }),
)
