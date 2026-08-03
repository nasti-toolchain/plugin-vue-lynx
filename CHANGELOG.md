# Changelog

## Unreleased

- Disable the placeholder `client` environment with `buildEnabled: false`
  instead of a no-op driver, avoiding a Nasti 2.4.2 transformMiddleware crash
  when every real target uses an external driver.
- Teach the native backend to serve and rebuild `.lynx.bundle` during
  `nasti dev` through a serve-only environment driver and
  `handleHotUpdateApp` coordination.
- Require Nasti `^2.4.1` so the native backend can use Environment CSS
  metadata, high-level `build.target`, and app-level entry helpers from the
  #36 Environment API completion.
- Collect native CSS through `BuildAppContext.getCss` with
  `build.css.inject/emit: false` instead of parsing browser `<style>` injection
  modules.
- Add an opt-in `backend: 'nasti'` milestone that builds Vue Lynx background
  and main-thread graphs with Rolldown and encodes a native `.lynx.bundle`
  with TASM.
- Add worklet, CSS serialization, configuration, and decoded-bundle coverage
  for the experimental native backend.
- Keep Rspeedy as the default backend while migrating off Rspack.

## 0.1.0

- Add the Rspeedy-backed `lynx` Nasti environment driver.
- Add optional parallel web builds and development services.
- Normalize Rspeedy build outputs, entries, manifests, stats, URLs, previews,
  and QR metadata.
- Add typed plugin API exposure and lifecycle bridging.
- Add Vue Lynx TypeScript/Volar example and compatibility validation.
- Add Lightning tests, production/development integration tests, CI, and npm
  trusted publishing workflow.
