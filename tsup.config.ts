import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/bin.ts'],
  format: ['esm'],
  clean: true,
  target: 'node18',
  outDir: 'dist',
});
