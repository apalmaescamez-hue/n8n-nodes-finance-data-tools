# Testing strategy

The package test strategy separates deterministic domain validation from n8n adapter validation.

## Automated checks

Run from the package root:

```bash
npm test
npm run lint
```

`npm test` runs Vitest domain and contract tests. `npm run lint` runs the n8n node linter. Treat linter warnings as work to fix even when the command exits with code 0.

`npm run build` is not part of this phase's executed validation.

## Current automated test scope

- Shared output contract.
- Data profiling.
- Data cleaning.
- Data normalization.
- Math and statistics.
- Financial ratios.
- Accounting validator and trial balance.
- Financial report builder.
- Predictive analytics.
- AI Finance Tool routing, limits, and predictive opt-in.

## Manual self-hosted smoke test

Use a local n8n instance only after automated checks pass:

```bash
npm run dev
```

Then import or recreate the templates under `examples/workflows/`:

1. Data quality wrapper.
2. Financial ratios wrapper.
3. Accounting validator wrapper.
4. AI Finance Tool wrapper.

For each wrapper, verify:

- The node appears in the n8n node panel.
- Parameters are visible and in English.
- The workflow executes with sample data.
- The output envelope has `success`, `operation`, `data`, `metadata`, `warnings`, `errors`, and `auditTrail`.
- Warnings are understandable and non-blocking.
- Blocking errors set `success` to `false`.

## Regression checklist

Before modifying a node or domain service:

- Add or update Vitest fixtures.
- Preserve the standard envelope.
- Keep n8n nodes thin; domain services remain pure TypeScript.
- Do not add filesystem, environment, network, Python, or arbitrary-code execution behavior.
- Re-run `npm test` and `npm run lint`.
