# @aleexpe03/n8n-nodes-finance-data-tools

Community node package for finance-oriented data quality, deterministic finance calculations, reporting, predictive analytics, and AI Agent wrappers in n8n.

This package is currently prepared as a self-hosted MVP. It is not published to npm from this repository state, and official n8n verification is not claimed.

## Implemented nodes

| Node | Purpose | Main operations |
| --- | --- | --- |
| Data Profiler | Profiles tabular JSON rows before finance preparation. | `profileDataset` |
| Data Cleaner | Cleans finance-oriented tabular rows. | `cleanDataset` |
| Data Normalizer | Maps and normalizes finance columns. | `normalizeDataset` |
| Math & Statistics | Runs allowlisted statistics and finance-safe math. | Summary statistics, percentile, correlation, growth, CAGR, z-score, IQR outliers, grouped aggregates |
| Financial Ratios | Calculates closed financial ratios from one aggregated finance object. | Profitability, liquidity, leverage, returns, growth, cash-flow, efficiency, unit economics |
| Accounting Validator | Validates journals and can generate a minimal trial balance. | Validate journal entries, validate and build trial balance, build trial balance |
| Financial Report Builder | Builds deterministic financial report JSON. | Executive summary, P&L, balance sheet, cash summary, KPI table, dashboard JSON, AI Agent report |
| Predictive Analytics | Runs explainable directional forecasting. | Moving average, CAGR forecast, trend forecast, simple linear regression |
| AI Finance Tool | Controlled facade for AI Agents. | Data, finance, accounting, report, and opt-in predictive operations |

## Documentation

- [Self-hosted installation and local development](docs/installation-self-hosted.md)
- [AI Agent wrapper guide](docs/ai-agent-wrapper.md)
- [Output contract](docs/output-contract.md)
- [Security and limitations](docs/security-and-limitations.md)
- [Testing strategy](docs/testing-strategy.md)
- [Release checklist](docs/release-checklist.md)

## Example workflow templates

Editable workflow templates live in [`examples/workflows/`](examples/workflows/):

- [`data-quality-wrapper.workflow.json`](examples/workflows/data-quality-wrapper.workflow.json)
- [`financial-ratios-wrapper.workflow.json`](examples/workflows/financial-ratios-wrapper.workflow.json)
- [`accounting-validator-wrapper.workflow.json`](examples/workflows/accounting-validator-wrapper.workflow.json)
- [`ai-finance-tool-wrapper.workflow.json`](examples/workflows/ai-finance-tool-wrapper.workflow.json)

The templates are intentionally marked as editable. If your n8n instance reports an unknown custom-node type during import, install/load this package first and confirm the exact node type shown by your n8n version.

## Self-hosted status

The MVP target is self-hosted n8n. Current documentation does not promise n8n Cloud availability or official verified-community-node status.

Important verification note: the package currently uses runtime dependencies (`date-fns`, `decimal.js`, `simple-statistics`, and `zod`). n8n's current verification guidance expects verified packages to avoid external runtime dependencies, so official verification requires a dependency strategy review before submission.

## Local development commands

```bash
npm test
npm run lint
npm run dev
```

`npm run dev` is the local n8n development path provided by the n8n node tooling. `npm run build` exists in `package.json`, but it is intentionally not part of this phase's executed validation.

## Standard output envelope

All nodes return a shared envelope:

```json
{
  "success": true,
  "operation": "profileDataset",
  "data": {},
  "metadata": {
    "generatedAt": "2026-05-09T00:00:00.000Z",
    "durationMs": 0,
    "rowCount": 0,
    "columnCount": 0
  },
  "warnings": [],
  "errors": [],
  "auditTrail": []
}
```

See [Output contract](docs/output-contract.md) for field-level semantics and predictive-output details.

## Architecture

The n8n nodes are thin adapters. Domain logic lives in pure TypeScript services under:

- `domain/data/profiling/`
- `domain/data/cleaning/`
- `domain/data/normalization/`
- `domain/math/statistics/`
- `domain/finance/ratios/`
- `domain/finance/reports/`
- `domain/accounting/`
- `domain/ml/forecasting/`
- `domain/ai/financeTool/`

Shared output, audit, error, and type helpers live in `shared/`.

## Safety model

- No Python runtime.
- No external APIs or microservices.
- No filesystem or environment-variable access in domain logic.
- No `eval`, formula interpreter, or arbitrary user-code execution.
- Operations are allowlisted and deterministic.
- Predictive output is directional, not a guarantee, and must surface warnings.

See [Security and limitations](docs/security-and-limitations.md) for the full model.

