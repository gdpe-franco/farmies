<template>
  <q-btn-dropdown
    outline
    no-caps
    class="farmies-preference"
    content-class="farmies-menu"
    :aria-label="label"
    :aria-describedby="selectionId"
  >
    <template #label>
      <span :id="selectionId">{{ selectedLabel }}</span>
      <span
        class="q-ml-sm"
        aria-hidden="true"
      >▾</span>
    </template>
    <q-list
      role="menu"
      :aria-label="label"
    >
      <q-item
        v-for="option in options"
        :key="option.value"
        v-close-popup
        clickable
        role="menuitemradio"
        :aria-checked="modelValue === option.value"
        :active="modelValue === option.value"
        @click="emit('select', option.value)"
      >
        <q-item-section :lang="option.lang">
          {{ option.label }}
        </q-item-section>
        <q-item-section side>
          <span
            v-if="modelValue === option.value"
            aria-hidden="true"
          >✓</span>
        </q-item-section>
      </q-item>
    </q-list>
  </q-btn-dropdown>
</template>

<script setup lang="ts">
import { useId } from 'vue'

const selectionId = useId()
defineProps<{
  label: string
  selectedLabel: string
  modelValue: string
  options: readonly { value: string; label: string; lang?: string }[]
}>()
const emit = defineEmits<{ select: [value: string] }>()
</script>
