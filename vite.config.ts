import { defineConfig } from 'vite';

export default defineConfig({
  base: '/fk-6-synth/',
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
