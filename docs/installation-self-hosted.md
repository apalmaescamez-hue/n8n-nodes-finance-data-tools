# Self-hosted installation and local development

Last reviewed: 2026-05-09.

This package is prepared for self-hosted n8n first. It is not published from this repository state, and no npm publication was performed during Phase 8.

## Official references

- Manual self-hosted community-node install: https://docs.n8n.io/integrations/community-nodes/installation/manual-install/
- Community-node installation and management: https://docs.n8n.io/integrations/community-nodes/installation/
- n8n node CLI build/lint/dev/release: https://docs.n8n.io/integrations/creating-nodes/build/n8n-node/
- n8n npm installation runtime range: https://docs.n8n.io/hosting/installation/npm/

As of the reviewed n8n npm installation page, n8n requires Node.js 20.19 through 24.x inclusive. Validate that range again before a real release because n8n updates frequently.

## Self-hosted install from npm after future publication

When the package is eventually published to npm, a self-hosted Docker installation follows n8n's manual community-node pattern:

```bash
docker exec -it n8n sh
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install n8n-nodes-finance-data-tools
# restart n8n after installation
```

For queue mode, private packages, or locked-down environments, prefer the manual install route and document exactly how the package was installed in the deployment runbook.

## GUI community-node install

For self-hosted instances that allow community-node installation from the n8n UI, install the package name once it exists on npm:

```text
n8n-nodes-finance-data-tools
```

Do not treat this as a Cloud guarantee. n8n Cloud and verified discovery require separate eligibility and verification work.

## Local development

From the package root:

```bash
npm test
npm run lint
npm run dev
```

`npm run dev` uses the n8n node tooling to compile the project and start a local n8n instance with the node loaded. Open `http://localhost:5678` after the command starts successfully.

Phase 8 validation did not run `npm run build`. Build validation is intentionally reserved for a future explicit release/build step.

## Local package testing before publication

For a future release candidate, use a clean self-hosted n8n instance and test with the wrapper workflows under `examples/workflows/`. If a tarball or private registry is used before public npm publication, record the exact package source, package version, and n8n version.

## Current compatibility posture

- Self-hosted MVP: yes, intended target.
- n8n Cloud: not promised.
- Official verification: not claimed.
- Public npm publication: not performed in this phase.
