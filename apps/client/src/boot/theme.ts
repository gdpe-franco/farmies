import { defineBoot } from '@quasar/app-vite'
import { Dark } from 'quasar'

import { useThemeStore } from '../stores/theme'

export default defineBoot(({ store }) => {
  useThemeStore(store).initialize(Dark)
})
