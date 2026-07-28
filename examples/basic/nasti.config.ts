import { defineConfig } from '@nasti-toolchain/nasti'
import { pluginVueLynx } from '@nasti-toolchain/plugin-vue-lynx'

export default defineConfig({
  plugins: [
    pluginVueLynx({
      entry: {
        main: './src/index.ts',
      },
      web: true,
      vue: {
        optionsApi: false,
      },
    }),
  ],
})
