# Changelog

## Unreleased

## 1.0.0

- Make `backend: 'nasti'` the default; keep Rspeedy available through
  `backend: 'rspeedy'` for web output and Rspeedy-only features.
- Add the native Nasti/Rolldown backend that builds Vue Lynx background and
  main-thread graphs and encodes a `.lynx.bundle` with TASM.
- Teach the native backend to serve and rebuild `.lynx.bundle` during
  `nasti dev` through a serve-only environment driver and
  `handleHotUpdateApp` coordination.
- Keep native dev middleware on the latest rebuild by flushing pending
  rebuilds before serving `.lynx.bundle`, rebuild in development mode, and
  emit change events from the native serve driver.
- Require Nasti `^2.4.1` so the native backend can use Environment CSS
  metadata, high-level `build.target`, and app-level entry helpers from the
  #36 Environment API completion.
- Collect native CSS through `BuildAppContext.getCss` with
  `build.css.inject/emit: false` instead of parsing browser `<style>` injection
  modules.
- Disable the placeholder `client` environment with `buildEnabled: false`
  instead of a no-op driver, avoiding a Nasti 2.4.2 transformMiddleware crash
  when every real target uses an external driver.
- Drop Rspeedy/Rspack from the example app dependencies now that the native
  backend is default; keep them as optional peers for `backend: 'rspeedy'`.
- Add worklet, CSS serialization, configuration, and decoded-bundle coverage
  for the native backend.

## 0.1.0

- Add the Rspeedy-backed `lynx` Nasti environment driver.
- Add optional parallel web builds and development services.
- Normalize Rspeedy build outputs, entries, manifests, stats, URLs, previews,
  and QR metadata.
- Add typed plugin API exposure and lifecycle bridging.
- Add Vue Lynx TypeScript/Volar example and compatibility validation.
- Add Lightning tests, production/development integration tests, CI, and npm
  trusted publishing workflow.
