import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm', 'cjs'],
  platform: 'node',
  target: 'node22.14',
  dts: {
    sourcemap: true,
  },
  outputOptions: {
    exports: 'named',
  },
  sourcemap: true,
  clean: true,
  publint: true,
})
