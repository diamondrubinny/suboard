import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/scripts/create-admin.ts', 'src/scripts/backup.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle the workspace package (TS source); keep real npm deps external.
  noExternal: ['@suboard/shared'],
});
