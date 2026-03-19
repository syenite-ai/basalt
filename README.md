# Basalt

**Policy enforcement runtime for DeFi agents.**

> Your agent, your rules, your risk. Basalt just makes sure the rules stick.

Basalt is a firewall for DeFi agents. It doesn't decide what's safe — you write the rules in `basalt.config.json`, and Basalt enforces them deterministically. No LLM, no agent, no bug in your strategy code can violate your configured policy.

Basalt is execution-backend agnostic. It validates transactions from any source — Syenite MCP, Orbs Agentic, direct RPC, raw calldata, any MCP server. Your agent decides *where* to get execution. Basalt decides whether the result is *allowed* under your policy.

## Disclaimer

**This software provides no financial advice.** No default parameters constitute recommendations. Users are solely responsible for their configuration. Example configs are illustrative only, not suggestions. Basalt is a tool, not an advisor.

This is the same posture as Uniswap, Aave, and all open-source DeFi middleware: we provide the software, not financial advice.

## Quickstart

```bash
npm install @syenite-ai/basalt

# Generate config template (all params blank — you fill them in)
npx basalt init

# Edit basalt.config.json with YOUR policy parameters

# Start the runtime (risk monitor + REST API)
npx basalt start
```

## How It Works

Basalt operates in two modes:

### Policy Gate (universal)

Your agent brings a transaction from *anywhere*. Basalt simulates it, checks it against your policy, approves or rejects.

```typescript
import { Basalt } from '@syenite-ai/basalt';

const basalt = new Basalt({});
await basalt.start();

// Agent got this tx from Orbs, Syenite, viem, wherever
const result = await basalt.validateTransaction({
  to: '0x...', data: '0x...', value: '0', chainId: 1,
});

if (result.approved) {
  // Agent signs and submits
} else {
  console.log('Blocked:', result.rejectionReason);
}
```

### Strategy Validation (uses DataProvider for richer checks)

```typescript
const check = await basalt.validateStrategy({
  type: 'carry',
  collateral: 'tBTC',
  collateralAmount: 2,
  borrowAsset: 'USDC',
  targetLTV: 35,
  deployTo: 'aave-v3-usdc-supply',
});
// check.approved, check.checks[], check.rejectionReason
```

### REST API (for Python, Go, or any language)

```bash
# Start Basalt
npx basalt start

# Validate any transaction (the core endpoint)
curl -X POST http://localhost:3100/api/validate/transaction \
  -H "Content-Type: application/json" \
  -d '{"to":"0x...","data":"0x...","value":"0","chainId":1}'

# Check risk status
curl http://localhost:3100/api/risk

# View portfolio
curl http://localhost:3100/api/portfolio
```

## Configuration

All policy parameters are **required**. Basalt refuses to start without them. There are no defaults — you must explicitly choose every value.

```json
{
  "provider": {
    "type": "syenite",
    "url": "${SYENITE_URL}"
  },
  "policy": {
    "maxLTV": null,
    "healthFactorFloor": null,
    "emergencyHealthFactor": null,
    "maxPositionUSD": null,
    "minProfitOverGasMultiple": null,
    "deleveragePercent": null,
    "allowedProtocols": [],
    "monitorIntervalMinutes": null
  }
}
```

### Policy Parameters Reference

| Parameter | Type | Description |
|---|---|---|
| `maxLTV` | number (0-100) | Maximum loan-to-value ratio. Strategies exceeding this are rejected. |
| `healthFactorFloor` | number (positive) | Health factor warning threshold. Risk monitor alerts when HF drops below. |
| `emergencyHealthFactor` | number (positive, < floor) | Health factor emergency threshold. Risk monitor triggers full unwind. |
| `maxPositionUSD` | number (positive) | Maximum single position size in USD. |
| `minProfitOverGasMultiple` | number (positive) | Minimum ratio of expected profit to gas cost. |
| `deleveragePercent` | number (0-100) | Percentage of borrow to repay when health factor crosses warning threshold. |
| `allowedProtocols` | string[] (non-empty) | Protocol identifiers you permit. Strategies targeting other protocols are rejected. |
| `monitorIntervalMinutes` | number (positive integer) | How often the risk monitor checks positions. |

These docs describe what each parameter **does**. They do not suggest what it **should** be.

## Architecture

```
Any Agent + Any Execution Source
  |
  |  "Here's a raw tx — is it allowed?"
  v
+----------------------------------------------+
| Basalt (Policy Enforcement Runtime)          |
|                                              |
|  Policy Gate    Orchestrator    State         |
|  (any tx,       (optional,     (SQLite/      |
|   any source)    convenience)   Postgres)    |
|                                              |
|  Risk Monitor (autonomous, user-configured)  |
|  DataProvider (pluggable — Syenite default)  |
+----------------------------------------------+
```

## CLI

```bash
npx basalt start                    # Start risk monitor + REST API
npx basalt check                    # One-shot risk check
npx basalt validate-tx --file tx.json  # Validate a raw transaction
npx basalt init                     # Generate config template
npx basalt help                     # Show help
```

## DataProvider

Basalt uses a pluggable `DataProvider` interface for simulation, verification, and market intelligence. Syenite is the default. You can write your own.

```typescript
import { Basalt } from '@syenite-ai/basalt';
import { SyeniteProvider } from '@syenite-ai/basalt/providers/syenite';

const basalt = new Basalt({
  provider: new SyeniteProvider({ url: 'https://syenite.ai/mcp' }),
});
```

## Examples

- [`examples/raw-tx-gate.ts`](examples/raw-tx-gate.ts) — Pure policy gate: validate any raw tx
- [`examples/carry-bot.ts`](examples/carry-bot.ts) — Full carry strategy with risk monitoring
- [`examples/carry-bot-rest.py`](examples/carry-bot-rest.py) — Python agent via REST API

## License

MIT. See [LICENSE](LICENSE).
