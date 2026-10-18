import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/FluxGraph-Studio/',
  build: {
    target: 'es2020',
    sourcemap: true,
  },
})
