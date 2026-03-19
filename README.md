# Basalt

**Policy enforcement runtime for DeFi agents.**

> Your agent, your rules, your risk. Basalt just makes sure the rules stick.

Basalt is a firewall for DeFi agents. You write the rules in `basalt.config.json`, and Basalt enforces them deterministically. No LLM, no agent, no bug in your strategy code can violate your configured policy.

**This software provides no financial advice.** No default parameters constitute recommendations. Users are solely responsible for their configuration. Example configs are illustrative only.

## What it does

- **Policy gate** — validate any transaction from any source (Syenite, Orbs, direct RPC, raw calldata) against your rules
- **Portfolio state** — track positions, P&L, exposure across protocols
- **Risk monitor** — autonomous background process that polls health factors and acts on your configured thresholds
- **Execution orchestration** — optional convenience layer for multi-step DeFi operations with per-step validation

## What it does NOT do

- Pick strategies (that's your agent's job)
- Run an LLM (bring your own)
- Hold opinions about markets or risk parameters
- Tell you what's safe (you decide, Basalt enforces)
- Lock you into an execution backend or agent framework

## Quick start

```bash
npm install @syenite-ai/basalt
cp basalt.config.example.json basalt.config.json
# Edit basalt.config.json — set YOUR policy parameters (required, no defaults)
```

```typescript
import { Basalt } from '@syenite-ai/basalt';
import { SyeniteProvider } from '@syenite-ai/basalt/providers/syenite';

const basalt = new Basalt({
  provider: new SyeniteProvider({ url: process.env.SYENITE_URL }),
  policy: {
    maxLTV: 40,                    // YOUR CHOICE
    healthFactorFloor: 1.5,        // YOUR CHOICE
    emergencyHealthFactor: 1.2,    // YOUR CHOICE
    maxPositionUSD: 100_000,       // YOUR CHOICE
    minProfitOverGasMultiple: 2.0, // YOUR CHOICE
    deleveragePercent: 20,         // YOUR CHOICE
    allowedProtocols: ['aave-v3'], // YOUR CHOICE
    monitorIntervalMinutes: 5,     // YOUR CHOICE
  },
});

// Validate any raw transaction against your policy
const check = await basalt.validateTransaction({
  to: '0x...', data: '0x...', value: '0', chainId: 1,
});

if (check.approved) {
  // sign and submit
} else {
  console.log('Blocked by policy:', check.rejectionReason);
}
```

## Architecture

```
Any Agent + Any Execution Source
  │
  │  "Here's a tx — is it allowed under my policy?"
  │
  ▼
┌──────────────────────────────────────────┐
│ Basalt (Policy Enforcement Runtime)       │
│                                           │
│  Policy Gate → Validate any tx            │
│  State       → Positions, P&L, snapshots  │
│  Risk Monitor → Autonomous kill switch    │
│  Orchestrator → Multi-step convenience    │
│                                           │
│  DataProvider (pluggable, Syenite default) │
└──────────────────────────────────────────┘
```

Basalt is execution-backend agnostic. It validates transactions from any source — Syenite MCP, Orbs Agentic, direct RPC, raw calldata, any MCP server. The agent decides *where* to get execution. Basalt decides whether the result is *allowed* under your policy.

## Configuration

All policy parameters are **required**. Basalt refuses to start without explicit configuration. See [`basalt.config.example.json`](basalt.config.example.json) for the full schema.

## DataProvider

Basalt uses a pluggable `DataProvider` interface for simulation, verification, and intelligence. The default is `SyeniteProvider` (connects to [Syenite MCP](https://syenite.ai)). You can implement your own provider for direct RPC, another MCP server, or any other data source.

## License

MIT — see [LICENSE](LICENSE).

---

*Basalt is a tool, not an advisor. It enforces your rules; it does not suggest them.*
