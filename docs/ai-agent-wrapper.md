# AI Agent wrapper guide

The package includes an `AI Finance Tool` node designed as a controlled facade for n8n AI Agent usage. The node is configured as usable as a tool and routes requests only to allowlisted deterministic domain operations.

## Recommended patterns

### 1. Native AI Agent tool pattern

Use this when your n8n version exposes the custom node as an AI Agent tool.

1. Add an AI Agent node.
2. Attach `AI Finance Tool` as a tool.
3. Configure a specific resource and operation.
4. Set row and forecast limits.
5. In the agent prompt, require the agent to report warnings, errors, and limitations.

Recommended agent instruction:

```text
Use AI Finance Tool only for deterministic finance/data operations. Always report warnings and errors. For predictive output, state that results are directional, not certainty, and do not infer causality.
```

### 2. Wrapper workflow pattern

Use this when you want a stable workflow boundary for agents, chatbots, or external systems.

Typical flow:

```text
Webhook or Chat Trigger -> input mapping -> AI Finance Tool -> response/summary
```

An AI Agent can call the wrapper through a workflow tool or HTTP Request tool. This keeps the custom package isolated and makes input validation explicit.

### 3. Manual analyst workflow pattern

Use this for finance users who want deterministic output before involving an LLM:

```text
Manual Trigger -> Data Cleaner/Data Normalizer/Financial Ratios/etc. -> AI Agent or report step
```

The AI Agent should summarize the existing envelope instead of recalculating values.

## AI Finance Tool operations

| Resource | Operation | Notes |
| --- | --- | --- |
| Data | `profile_data` | Profiles tabular rows. |
| Data | `clean_data` | Cleans tabular rows. |
| Data | `normalize_data` | Normalizes finance columns. |
| Finance | `calculate_statistics` | Requires `valueColumn` and optional domain options. |
| Finance | `calculate_financial_ratios` | Expects one aggregated finance object. |
| Accounting | `validate_accounting_entries` | Expects accounts and entries in one object. |
| Report | `build_financial_report` | Builds deterministic report JSON. |
| Prediction | `forecast_financial_metric` | Disabled by default; requires explicit opt-in. |
| Prediction | `train_simple_regression` | Disabled by default; requires explicit opt-in. |
| Prediction | `evaluate_prediction_model` | Disabled by default; requires explicit opt-in. |

## Safety controls

- `maxRows` limits incoming rows.
- `allowPredictiveOperations` defaults to `false`.
- `maxForecastHorizon` limits prediction horizon.
- `advancedOptionsJson` must be a JSON object; it is not code and formulas are not evaluated.
- The output includes `agentInstructions` with summarization and warning behavior.

## Expected input shapes

For row-based operations, pass rows as multiple input items or as one object containing `data`:

```json
{
  "data": [
    { "period": "2026-01", "revenue": "1000" },
    { "period": "2026-02", "revenue": "1200" }
  ]
}
```

For object-based operations such as ratios, accounting, and reports, pass one JSON object:

```json
{
  "currency": "EUR",
  "revenue": "100000",
  "grossProfit": "60000",
  "netIncome": "18000"
}
```

## Template workflows

See:

- `examples/workflows/ai-finance-tool-wrapper.workflow.json`
- `examples/workflows/data-quality-wrapper.workflow.json`
- `examples/workflows/financial-ratios-wrapper.workflow.json`
- `examples/workflows/accounting-validator-wrapper.workflow.json`

These are editable templates. n8n workflow exports can differ between versions, so confirm custom node type names in your instance after installing the package.
