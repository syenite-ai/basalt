/**
 * carry-bot.ts — Carry trade strategy example.
 *
 * Every parameter is YOUR CHOICE. Basalt does not advise on any of these values.
 * See the README for what each parameter does.
 *
 * This software provides NO financial advice.
 */

import 'dotenv/config';
import { Basalt } from '@syenite-ai/basalt';
import { SyeniteProvider } from '@syenite-ai/basalt/providers/syenite';

const basalt = new Basalt({
  provider: new SyeniteProvider({
    url: process.env.SYENITE_URL || 'https://syenite.ai/mcp',
    apiKey: process.env.SYENITE_API_KEY,
  }),
  config: {
    provider: {
      type: 'syenite',
      url: process.env.SYENITE_URL || 'https://syenite.ai/mcp',
    },
    wallet: process.env.WALLET_PRIVATE_KEY
      ? { privateKey: process.env.WALLET_PRIVATE_KEY }
      : undefined,
    policy: {
      // YOUR CHOICES — Basalt does not advise on any of these values.
      // See docs for what each parameter does, not what it "should" be.
      maxLTV: 40,                      // YOUR CHOICE — max loan-to-value ratio
      healthFactorFloor: 1.5,          // YOUR CHOICE — HF warning threshold
      emergencyHealthFactor: 1.2,      // YOUR CHOICE — HF emergency threshold
      maxPositionUSD: 100_000,         // YOUR CHOICE — max single position size
      minProfitOverGasMultiple: 2.0,   // YOUR CHOICE — min profit/gas ratio
      deleveragePercent: 20,           // YOUR CHOICE — % to repay on warning
      allowedProtocols: ['aave-v3', 'morpho', 'spark'], // YOUR CHOICE — protocols you trust
      monitorIntervalMinutes: 5,       // YOUR CHOICE — how often to check positions
    },
  },
});

await basalt.start();
basalt.startRiskMonitor();
basalt.startRestApi();

// Custom risk event handler
basalt.onRiskEvent((event) => {
  console.log(`[RISK ${event.severity.toUpperCase()}] HF=${event.healthFactor} — ${event.actionTaken}`);
});

// Strategy loop — runs every 4 hours
async function checkForOpportunities(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Scanning carry opportunities...\n`);

  try {
    const opportunities = await basalt.provider.carryScreen({
      collateral: 'tBTC',
      borrowAsset: 'USDC',
    });

    const best = opportunities.strategies[0];
    if (!best || best.netCarry <= 0) {
      console.log('No positive carry opportunities found. Waiting...\n');
      return;
    }

    console.log(`Best carry: ${best.market} — ${best.netCarry.toFixed(2)}% net\n`);

    // Validate strategy against YOUR policy
    const validation = await basalt.validateStrategy({
      type: 'carry',
      collateral: 'tBTC',
      collateralAmount: 2,
      borrowAsset: 'USDC',
      targetLTV: 35,
      deployTo: best.market,
    });

    if (!validation.approved) {
      console.log('Strategy rejected by YOUR policy:', validation.rejectionReason);
      return;
    }

    // Build carry sequence (dry_run in Phase 1)
    const result = await basalt.buildCarrySequence({
      collateral: 'tBTC',
      collateralAmount: 2,
      borrowAsset: 'USDC',
      targetLTV: 35,
      deployTo: best.market,
    });

    console.log(`Execution result: ${result.status}`);
    console.log(`Steps: ${result.steps.length}`);
    for (const step of result.steps) {
      console.log(`  [${step.status}] ${step.action}`);
    }
  } catch (err) {
    console.error('Error:', (err as Error).message);
  }
}

// Run immediately, then every 4 hours
checkForOpportunities();
setInterval(checkForOpportunities, 4 * 60 * 60 * 1000);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await basalt.stop();
  process.exit(0);
});
