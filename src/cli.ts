#!/usr/bin/env node

import 'dotenv/config';
import { resolve } from 'node:path';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { Basalt } from './index.js';
import { loadConfig, logDisclaimer } from './config.js';

const COMMANDS = ['start', 'check', 'validate-tx', 'init', 'help'] as const;
type Command = typeof COMMANDS[number];

function printUsage(): void {
  console.log(`
basalt — Policy enforcement runtime for DeFi agents.

Usage:
  basalt start                    Start risk monitor + REST API
  basalt check                    One-shot risk check, print status
  basalt validate-tx --file <f>   Validate a raw transaction from JSON file
  basalt init                     Generate basalt.config.json template
  basalt help                     Show this help message

Options:
  --config <path>    Path to config file (default: ./basalt.config.json)
  --port <number>    REST API port override
  --file <path>      Transaction JSON file for validate-tx

This software provides NO financial advice.
You are solely responsible for your configuration.
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = (args[0] ?? 'help') as Command;

  if (!COMMANDS.includes(command)) {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }

  const configPath = getArg(args, '--config');
  const port = getArg(args, '--port');

  switch (command) {
    case 'help':
      printUsage();
      break;

    case 'init':
      await cmdInit();
      break;

    case 'start':
      await cmdStart(configPath, port ? parseInt(port, 10) : undefined);
      break;

    case 'check':
      await cmdCheck(configPath);
      break;

    case 'validate-tx': {
      const filePath = getArg(args, '--file');
      if (!filePath) {
        console.error('--file is required for validate-tx');
        process.exit(1);
      }
      await cmdValidateTx(configPath, filePath);
      break;
    }
  }
}

async function cmdInit(): Promise<void> {
  const target = resolve(process.cwd(), 'basalt.config.json');
  if (existsSync(target)) {
    console.error(`basalt.config.json already exists at ${target}`);
    process.exit(1);
  }

  const template = {
    _WARNING: 'EXAMPLE ONLY — these values are NOT financial advice. You MUST choose your own values.',
    provider: {
      type: 'syenite',
      url: '${SYENITE_URL}',
      apiKey: '${SYENITE_API_KEY}',
    },
    wallet: {
      privateKey: '${WALLET_PRIVATE_KEY}',
    },
    policy: {
      _NOTE: 'ALL policy parameters are REQUIRED. Basalt refuses to start without them.',
      maxLTV: null,
      healthFactorFloor: null,
      emergencyHealthFactor: null,
      maxPositionUSD: null,
      minProfitOverGasMultiple: null,
      deleveragePercent: null,
      allowedProtocols: [],
      monitorIntervalMinutes: null,
    },
    notifications: {
      webhookUrl: '${WEBHOOK_URL}',
      onWarning: true,
      onCritical: true,
      onEmergency: true,
      onRejection: true,
    },
    api: {
      port: 3100,
      auth: '${API_AUTH_TOKEN}',
    },
  };

  writeFileSync(target, JSON.stringify(template, null, 2) + '\n');
  console.log(`Created basalt.config.json at ${target}`);
  console.log('Fill in YOUR policy parameters, then run: npx basalt start');
}

async function cmdStart(configPath?: string, port?: number): Promise<void> {
  const basalt = new Basalt({ configPath });
  await basalt.start();
  basalt.startRiskMonitor();
  basalt.startRestApi(port);

  const shutdown = async () => {
    console.log('\n[basalt] Shutting down...');
    await basalt.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function cmdCheck(configPath?: string): Promise<void> {
  const basalt = new Basalt({ configPath });
  await basalt.start();
  logDisclaimer();

  const result = await basalt.checkRisk();
  console.log(JSON.stringify(result, null, 2));

  await basalt.stop();
}

async function cmdValidateTx(configPath?: string, filePath?: string): Promise<void> {
  if (!filePath) {
    console.error('--file is required');
    process.exit(1);
  }

  const resolved = resolve(process.cwd(), filePath);
  if (!existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  const raw = readFileSync(resolved, 'utf-8');
  const tx = JSON.parse(raw);

  const basalt = new Basalt({ configPath });
  await basalt.start();

  const result = await basalt.validateTransaction(tx);
  console.log(JSON.stringify(result, null, 2));

  await basalt.stop();
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
