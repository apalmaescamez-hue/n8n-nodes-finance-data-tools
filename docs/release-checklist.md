# Release checklist

This checklist prepares the package for self-hosted release and future official verification work without publishing from the current phase.

## Current Phase 8 status

- npm publication: not performed.
- `npm run build`: not executed.
- GitHub publish workflow: not created.
- Target: self-hosted MVP readiness.

## Self-hosted release checklist

- [ ] Confirm package name starts with `n8n-nodes-`.
- [ ] Confirm `n8n-community-node-package` keyword exists.
- [ ] Confirm every node is registered under `package.json > n8n.nodes`.
- [ ] Confirm README links installation, output contract, security, testing, release, and examples.
- [ ] Confirm `LICENSE` matches the MIT license declared in `package.json`.
- [ ] Confirm `CHANGELOG.md` has the intended version notes.
- [ ] Confirm `docs/` and `examples/` are included in `package.json > files` if they should ship in the npm package.
- [ ] Run `npm test`.
- [ ] Run `npm run lint` and fix warnings.
- [ ] Run local n8n smoke tests with `npm run dev`.
- [ ] Only when explicitly allowed, run build/package validation.
- [ ] Publish only after repository, npm ownership, and provenance strategy are decided.

## Future official verification checklist

Before attempting verification through n8n Creator Portal:

- [ ] Keep all node UI and documentation in English.
- [ ] Make the repository public and ensure npm repository metadata points to it.
- [ ] Confirm author/maintainer consistency between npm and repository.
- [ ] Ensure MIT license.
- [ ] Remove or resolve runtime external dependencies, because current guidance expects no external runtime dependencies for verified community nodes.
- [ ] Confirm code does not read environment variables or the local filesystem.
- [ ] Confirm no external APIs, proxy behavior, or unrelated third-party service aggregation.
- [ ] Run n8n lint and any required community package scan.
- [ ] Publish through GitHub Actions with npm provenance if official verification is desired after 2026-05-01.

## GitHub Actions provenance note

As of the reviewed n8n publication guidance, verification submissions after 2026-05-01 require npm publication through GitHub Actions with provenance. This repository intentionally does not include an active publish workflow in Phase 8.

If a future maintainer wants verification, create `.github/workflows/publish.yml` only after an explicit release decision. Do not add an active publishing workflow casually; it can publish on tags or release events if misconfigured.

## Recommended release gates

1. Documentation review.
2. Automated tests and lint.
3. Manual self-hosted smoke test.
4. Package contents review.
5. Security/dependency review.
6. Provenance/publishing decision.

