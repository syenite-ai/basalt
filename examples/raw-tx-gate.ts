/**
 * raw-tx-gate.ts — Purest policy gate usage.
 *
 * Agent constructs raw calldata from any source (Orbs, Syenite, viem, etc.)
 * and passes it to Basalt for validation against YOUR configured policy.
 *
 * Basalt doesn't care where the tx came from. It checks against YOUR rules.
 *
 * This software provides NO financial advice.
 */

import 'dotenv/config';
import { Basalt } from '@syenite-ai/basalt';

const basalt = new Basalt({});
await basalt.start();

// Agent got this tx from anywhere — Orbs, Syenite, direct RPC, raw calldata
const rawTx = {
  to: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2', // Aave V3 Pool
  data: '0x617ba037...', // supply() calldata
  value: '0',
  chainId: 1,
  from: '0xYourWalletAddress',
};

console.log('Validating transaction against YOUR policy...\n');

const result = await basalt.validateTransaction(rawTx);

if (result.approved) {
  console.log('APPROVED — tx passes all policy checks.\n');
  console.log('Checks:');
  for (const check of result.checks) {
    console.log(`  [${check.status.toUpperCase()}] ${check.rule}: ${check.detail}`);
  }
  // Agent signs and submits the tx themselves
} else {
  console.log('REJECTED — tx violates your policy.\n');
  console.log('Reason:', result.rejectionReason);
  console.log('\nChecks:');
  for (const check of result.checks) {
    console.log(`  [${check.status.toUpperCase()}] ${check.rule}: ${check.detail}`);
  }
}

await basalt.stop();
