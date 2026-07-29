import { defineConfig } from '@nasti-toolchain/nasti'
import { pluginVueLynx } from '@nasti-toolchain/plugin-vue-lynx'

const useNativeBackend = process.env['VUE_LYNX_NATIVE_BACKEND'] === '1'

export default defineConfig({
  plugins: [
    pluginVueLynx({
      backend: useNativeBackend ? 'nasti' : 'rspeedy',
      entry: {
        main: './src/index.ts',
      },
      web: useNativeBackend ? false : true,
      vue: {
        optionsApi: false,
      },
    }),
  ],
})
