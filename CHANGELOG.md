# Changelog

## Unreleased

- Add an opt-in, production-only `backend: 'nasti'` milestone that builds Vue
  Lynx background and main-thread graphs with Rolldown and encodes a native
  `.lynx.bundle` with TASM.
- Add worklet, CSS serialization, configuration, and decoded-bundle coverage
  for the experimental native backend.
- Require Nasti 2.4 while keeping Rspeedy as the default backend.

## 0.1.0

- Add the Rspeedy-backed `lynx` Nasti environment driver.
- Add optional parallel web builds and development services.
- Normalize Rspeedy build outputs, entries, manifests, stats, URLs, previews,
  and QR metadata.
- Add typed plugin API exposure and lifecycle bridging.
- Add Vue Lynx TypeScript/Volar example and compatibility validation.
- Add Lightning tests, production/development integration tests, CI, and npm
  trusted publishing workflow.
