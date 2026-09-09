<script setup>
import { ref } from 'vue'
import UiIcon from './UiIcon.vue'

defineOptions({ inheritAttrs: false })
defineProps({ modelValue: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue'])
const visible = ref(false)
</script>

<template>
  <span class="password-field">
    <input
      v-bind="$attrs"
      :type="visible ? 'text' : 'password'"
      :value="modelValue"
      @input="emit('update:modelValue', $event.target.value)"
    />
    <button
      type="button"
      class="toggle-password"
      :aria-label="visible ? 'Hide password' : 'Show password'"
      :aria-pressed="visible ? 'true' : 'false'"
      @mousedown.prevent
      @click="visible = !visible"
    >
      <UiIcon :name="visible ? 'eye-off' : 'eye'" :size="18" />
    </button>
  </span>
</template>

<style scoped>
.password-field { position: relative; display: block; width: 100%; }
.password-field input { width: 100%; padding-right: 44px; box-sizing: border-box; }
.toggle-password { position: absolute; top: 50%; right: 2px; transform: translateY(-50%); width: 40px; height: 40px; border: none; background: none; color: var(--text-muted, #888); display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; cursor: pointer; }
.toggle-password:hover { color: var(--text, inherit); }
</style>
