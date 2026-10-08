import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({ root: 'src/renderer', base: './', plugins: [react()], test: { root: '.', include: ['src/**/*.test.ts'] }, server: { port: 5173, strictPort: true }, build: { outDir: '../../dist/renderer', emptyOutDir: true } })
