# Security and limitations

This package is intentionally deterministic and self-contained for a self-hosted MVP.

## Security model

- No Python runtime.
- No external API calls from package code.
- No microservices.
- No file-system reads/writes from domain logic.
- No environment-variable access from domain logic.
- No `eval`, dynamic formula language, or arbitrary user-code execution.
- Operations are explicit allowlists.
- Advanced options are JSON configuration objects, not executable code.
- AI Agent support is a controlled facade around existing deterministic services.

## Dependency and verification status

The package currently has runtime dependencies in `package.json`:

- `date-fns`
- `decimal.js`
- `simple-statistics`
- `zod`

This is acceptable for the self-hosted MVP, but it creates tension with n8n's current verified-community-node guidance, which expects verified packages to avoid external runtime dependencies. Before any official verification attempt, decide whether to remove, inline, replace, or otherwise justify those dependencies.

Official verification is not claimed.

## Data and privacy boundaries

- Data stays inside the n8n workflow execution unless the user's workflow sends it elsewhere.
- This package does not transmit data to external services.
- No credentials are required by these nodes.
- Workflows that add AI models, HTTP calls, databases, or storage introduce their own data-governance obligations.

## Functional limitations

- Datasets are processed in memory.
- This is not an ERP, accounting system of record, or audit-certified ledger.
- Financial ratios expect aggregated financial input; broad dataset aggregation is intentionally postponed.
- Forecasting is directional and exploratory.
- Predictive output is not causal analysis.
- Small samples, outliers, long horizons, and missing values reduce reliability and produce warnings where detected.
- The package does not guarantee n8n Cloud compatibility.
- The package has not been submitted for official n8n verification.

## AI Agent limitations

- The AI Finance Tool is a facade, not an autonomous planner.
- Agents must mention warnings and errors.
- Agents must not overstate predictive outputs.
- Agents must not infer missing accounting or business context.
- Predictive operations are disabled by default and require explicit opt-in.

