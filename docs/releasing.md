# Releasing

Releases publish `@nasti-toolchain/plugin-vue-lynx` from GitHub Actions with
npm trusted publishing. The workflow does not use an `NPM_TOKEN`.

## One-time npm setup

Trusted publishing is configured in npm's package settings, so the package must
exist before the publisher can be attached. If `0.1.0` is the first publication,
an npm owner must bootstrap the package once, then configure:

- provider: **GitHub Actions**;
- organization or user: `nasti-toolchain`;
- repository: `plugin-vue-lynx`;
- workflow filename: `release.yml`;
- environment: `npm`.

The workflow uses the GitHub-hosted runner, Node 24, npm 11.5.1 or newer, and
the required `id-token: write` permission. npm generates provenance
automatically for trusted publications.

Create a protected GitHub environment named `npm`. Reviewers may be required
for production releases, but the environment name must remain aligned with the
npm trusted-publisher configuration.

## Publish a version

1. Update `version` in `package.json` and add the release notes to
   `CHANGELOG.md`.
2. Run `pnpm install --frozen-lockfile`, `pnpm check`, and
   `pnpm test:integration`.
3. Merge the release commit to `main`.
4. Create and publish a GitHub release tagged exactly `v<package version>`,
   for example `v0.1.0`.
5. The `Release` workflow verifies the tag, reruns all checks, and executes
   `npm publish --access public` through OIDC.

The tag/version guard intentionally fails before publishing if the GitHub
release tag and `package.json` disagree.

Reference: [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/).
