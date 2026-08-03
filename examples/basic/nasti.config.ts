import { defineConfig } from '@nasti-toolchain/nasti'
import { pluginVueLynx } from '@nasti-toolchain/plugin-vue-lynx'

const useRspeedyBackend = process.env['VUE_LYNX_RSPEEDY_BACKEND'] === '1'

export default defineConfig({
  plugins: [
    pluginVueLynx({
      backend: useRspeedyBackend ? 'rspeedy' : 'nasti',
      entry: {
        main: './src/index.ts',
      },
      web: useRspeedyBackend ? true : false,
      vue: {
        optionsApi: false,
      },
    }),
  ],
})
