import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import GuestApp from './GuestApp.vue'
import { parseGuestHash } from './components/shareLinks.js'
import './style.css'
import './vaulta-theme.css'

// /s/<hash> is the guest entry: no login, no user stores, only the public API.
const guestHash = parseGuestHash(window.location.pathname)
const app = guestHash ? createApp(GuestApp, { hash: guestHash }) : createApp(App)
app.use(createPinia()).mount('#app')
