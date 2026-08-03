# @nasti-toolchain/plugin-vue-lynx

Build [Vue Lynx](https://vue.lynxjs.org/) applications through Nasti. The
default backend builds native Lynx graphs with Nasti/Rolldown and encodes a
`.lynx.bundle`. Pass `backend: 'rspeedy'` for the optional Rspack-backed driver
when you need web output or other Rspeedy-only features.

Version 1.0 provides:

- a default native `lynx` pipeline with background and main-thread Rolldown
  graphs;
- development rebuilds of the encoded `.lynx.bundle` with QR-ready URLs;
- an optional Rspeedy-backed `lynx` / `web` environment driver;
- production build results normalized to Nasti outputs, entries, manifest, and
  stats;
- watch, HMR, and idempotent close lifecycle integration;
- a typed API exposed through Nasti's `useExposed`;
- TypeScript, vue-tsc, and Volar setup through Vue Lynx.

## Install

Native backend (default — no Rspack / Rspeedy required):

```sh
pnpm add -D \
  @nasti-toolchain/nasti@^2.4.1 \
  @nasti-toolchain/plugin-vue-lynx@^1.0.0 \
  vue-lynx@^0.5.1 \
  @lynx-js/css-serializer@^0.1.5 \
  @lynx-js/react@^0.116.5 \
  @lynx-js/tasm@^0.0.26
```

Optional Rspeedy backend (web output and Rspeedy-only features). The current
Vue Lynx release uses the Rsbuild 1 generation:

```sh
pnpm add -D \
  @lynx-js/rspeedy@^0.14.5 \
  @rsbuild/plugin-vue@^1.2.6 \
  @rspack/core@^1.7.0
```

`vue-lynx@0.5.1` currently allows
`@lynx-js/css-extract-webpack-plugin@0.7.1`, although that release requires a
newer template plugin. pnpm projects that install the Rspeedy peers should pin
the known-compatible release:

```yaml
# pnpm-workspace.yaml
overrides:
  '@lynx-js/css-extract-webpack-plugin': 0.7.0
```

Missing or unsupported optional peers fail only when the matching backend is
used, with an actionable installation error.

## Configure Nasti

```ts
// nasti.config.ts
import { defineConfig } from '@nasti-toolchain/nasti'
import { pluginVueLynx } from '@nasti-toolchain/plugin-vue-lynx'

export default defineConfig({
  base: '/',
  plugins: [
    pluginVueLynx({
      entry: {
        main: './src/index.ts',
      },
      outDir: 'dist/lynx',
      vue: {
        optionsApi: false,
      },
    }),
  ],
})
```

```sh
pnpm nasti build
pnpm nasti dev
```

This creates independent `lynx-background` and `lynx-main-thread` Rolldown
graphs, applies the Vue Lynx worklet transforms, serializes CSS, and uses TASM
to emit `dist/lynx/main.lynx.bundle`. During `nasti dev`, a serve-only driver
rebuilds that bundle on change and publishes the QR-ready URL through Nasti's
environment services.

The native backend currently supports one native entry with unscoped CSS. Web
output, scoped CSS and CSS preprocessors, async/lazy chunks, IFR, and asset
routing remain available through `backend: 'rspeedy'`.

See the complete runnable project in [`examples/basic`](./examples/basic).

## Optional Rspeedy backend

```ts
pluginVueLynx({
  backend: 'rspeedy',
  entry: {
    main: './src/index.ts',
  },
  outDir: 'dist/lynx',
  web: {
    outDir: 'dist/web',
  },
  rspeedy: ({ command, environment }) => ({
    performance: {
      printFileSize: command === 'build',
    },
    source: {
      define: {
        __NASTI_ENVIRONMENT__: JSON.stringify(environment.name),
      },
    },
  }),
})
```

Nasti's `root`, `mode`, entry, output directory, public path, source maps,
minification, server host/port/base/proxy, HMR, and live reload are mapped to
Rspeedy. Use `rspeedy` for shared advanced configuration and `lynx.rspeedy` or
`web.rspeedy` for target-specific overrides.

## TypeScript and Volar

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["vue-lynx/types"],
    "noEmit": true
  },
  "vueCompilerOptions": {
    "plugins": ["vue-lynx/types/volar-plugin"]
  }
}
```

Run `vue-tsc --noEmit` in CI. The example uses the same setup.

## Plugin API and bridge

Another Nasti plugin can consume the typed state and lifecycle stream:

```ts
import type { NastiPlugin } from '@nasti-toolchain/nasti'
import {
  VUE_LYNX_PLUGIN_API_KEY,
  type VueLynxPluginApi,
} from '@nasti-toolchain/plugin-vue-lynx'

export const inspectVueLynx = (): NastiPlugin => ({
  name: 'inspect-vue-lynx',
  pre: ['@nasti-toolchain/plugin-vue-lynx'],
  setup(api) {
    const vueLynx = api.useExposed<VueLynxPluginApi>(
      VUE_LYNX_PLUGIN_API_KEY,
    )
    vueLynx?.subscribe((event) => {
      api.logger.info(`${event.environment}: ${event.type}`)
    })
  },
})
```

For integration code that does not need a Nasti plugin, pass a `bridge.onEvent`
callback to `pluginVueLynx`. Build and serve events include normalized results;
change and close events mirror the environment-driver lifecycle.

## Compatibility

| Component | v1.0 support |
| --- | --- |
| Node.js | `>=22.14.0` |
| Nasti | `^2.4.1` |
| Vue Lynx | `>=0.5.1 <1` (tested with `0.5.1`) |
| Rspeedy (optional) | `>=0.13.5 <0.15` (tested with `0.14.5`) |
| Rsbuild plugin Vue (optional) | `>=1.2.6 <2` |
| Rspack (optional) | `>=1.7 <2` |

Rspeedy `0.15+` uses Rsbuild 2, while Vue Lynx `0.5.x` still configures the
Rsbuild 1 SWC pipeline. The driver rejects that combination before compilation
and explains how to install the compatible range.

## Development

This repository uses pnpm, tsdown, TypeScript, and
[Lightning](https://github.com/zixiao-labs/Lightning):

```sh
corepack enable
pnpm install
pnpm check
pnpm test:integration
```

`pnpm check` runs strict type checking, the Lightning suite, tsdown, publint,
and Are the Types Wrong. Integration tests perform real Lynx production builds,
an optional Rspeedy/web build, and development-server smoke tests for both
backends.

Release setup is documented in [`docs/releasing.md`](./docs/releasing.md).

## License

MIT
