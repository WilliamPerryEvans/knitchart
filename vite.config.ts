import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // GitHub project pages serve from /<repo>/, but the Tauri desktop build loads
  // dist/ off the filesystem and breaks if asset URLs are prefixed. So the base
  // path is set only by the Pages workflow, never for the desktop build.
  base: process.env.GITHUB_PAGES ? '/knitchart/' : '/',
  plugins: [react()],
})
