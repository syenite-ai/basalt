import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Orchestrator } from '../src/orchestrator.js';
import { Validator } from '../src/validator.js';
import { SQLiteStore } from '../src/state.js';
import { unlinkSync, existsSync } from 'node:fs';
import type { DataProvider, PolicyConfig } from '../src/types.js';

const TEST_DB = './__test_orchestrator.db';

function cleanup(): void {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

const POLICY: PolicyConfig = {
  maxLTV: 40,
  healthFactorFloor: 1.5,
  emergencyHealthFactor: 1.2,
  maxPositionUSD: 100000,
  minProfitOverGasMultiple: 2.0,
  deleveragePercent: 20,
  allowedProtocols: ['aave-v3'],
  monitorIntervalMinutes: 5,
};

function createMockProvider(): DataProvider {
  return {
    txSimulate: async () => ({ success: true, gasUsed: '21000' }),
    txVerify: async () => ({ verified: true, contractName: 'AavePool' }),
    txGuard: async () => ({ passed: true, failedRules: [], details: {} }),
    riskAssess: async () => ({
      healthFactor: 2.3, liquidationPrice: 42000, currentPrice: 82500,
      maxBorrow: 100000, protocol: 'aave-v3', risk: 'low',
    }),
    positionMonitor: async () => ({ positions: [] }),
    carryScreen: async () => ({
      strategies: [{
        market: 'aave-v3-usdc', protocol: 'aave-v3',
        supplyRate: 0.5, borrowRate: 3.2, netCarry: 2.1, healthFactor: 2.3,
      }],
    }),
    gasEstimate: async () => ({
      chain: 'ethereum', gasPrice: '30',
      estimates: { lending_supply: { gas: 200000, costUSD: 0.5 } },
    }),
    walletBalances: async () => ({
      address: '0x123', balances: [{ chain: 'ethereum', asset: 'ETH', balance: '1.0', valueUSD: 3000 }],
    }),
  };
}

describe('Orchestrator', () => {
  let store: SQLiteStore;
  let validator: Validator;
  let orchestrator: Orchestrator;
  let provider: DataProvider;

  beforeEach(async () => {
    cleanup();
    store = new SQLiteStore(TEST_DB);
    await store.init();
    provider = createMockProvider();
    validator = new Validator(provider, POLICY, store);
    orchestrator = new Orchestrator(provider, POLICY, validator, store);
  });

  afterEach(async () => {
    await store.close();
    cleanup();
  });

  describe('buildCarrySequence', () => {
    it('returns dry_run with validated steps', async () => {
      const result = await orchestrator.buildCarrySequence({
        collateral: 'tBTC',
        collateralAmount: 2,
        borrowAsset: 'USDC',
        targetLTV: 35,
        deployTo: 'aave-v3-usdc-supply',
      });

      expect(result.status).toBe('dry_run');
      expect(result.steps.length).toBe(5);
      expect(result.steps.every((s) => s.status === 'validated')).toBe(true);
    });

    it('rejects when strategy validation fails', async () => {
      const result = await orchestrator.buildCarrySequence({
        collateral: 'tBTC',
        collateralAmount: 2,
        borrowAsset: 'USDC',
        targetLTV: 50,
        deployTo: 'aave-v3-usdc-supply',
      });

      expect(result.status).toBe('rejected');
      expect(result.rejectionReason).toBeDefined();
    });

    it('logs activity on execution', async () => {
      await orchestrator.buildCarrySequence({
        collateral: 'tBTC',
        collateralAmount: 2,
        borrowAsset: 'USDC',
        targetLTV: 35,
        deployTo: 'aave-v3-usdc-supply',
      });

      const activities = await store.getActivity();
      expect(activities.length).toBeGreaterThan(0);
    });
  });

  describe('buildDeleverageSequence', () => {
    it('returns empty steps when no borrows exist', async () => {
      const result = await orchestrator.buildDeleverageSequence({ percent: 20 });
      expect(result.status).toBe('dry_run');
      expect(result.steps).toHaveLength(0);
    });

    it('builds deleverage steps for active borrows', async () => {
      await store.addPosition({
        protocol: 'aave-v3', chain: 'ethereum', asset: 'USDC',
        amount: 50000, side: 'borrow', entryTime: new Date().toISOString(), status: 'active',
      });

      const result = await orchestrator.buildDeleverageSequence({ percent: 20 });
      expect(result.status).toBe('dry_run');
      expect(result.steps.length).toBeGreaterThan(0);
    });
  });

  describe('buildUnwindSequence', () => {
    it('builds unwind steps for all active positions', async () => {
      await store.addPosition({
        protocol: 'aave-v3', chain: 'ethereum', asset: 'USDC',
        amount: 50000, side: 'borrow', entryTime: new Date().toISOString(), status: 'active',
      });
      await store.addPosition({
        protocol: 'aave-v3', chain: 'ethereum', asset: 'tBTC',
        amount: 2, side: 'collateral', entryTime: new Date().toISOString(), status: 'active',
      });

      const result = await orchestrator.buildUnwindSequence();
      expect(result.status).toBe('dry_run');
      // 2 steps for borrow (approve + repay) + 1 for collateral (withdraw)
      expect(result.steps.length).toBe(3);
    });
  });
});
