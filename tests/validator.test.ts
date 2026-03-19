import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Validator } from '../src/validator.js';
import { SQLiteStore } from '../src/state.js';
import { unlinkSync, existsSync } from 'node:fs';
import type { DataProvider, PolicyConfig, RawTransaction } from '../src/types.js';

const TEST_DB = './__test_validator.db';

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
  allowedProtocols: ['aave-v3', 'morpho'],
  monitorIntervalMinutes: 5,
};

function createMockProvider(overrides?: Partial<DataProvider>): DataProvider {
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
    ...overrides,
  };
}

describe('Validator', () => {
  let store: SQLiteStore;
  let validator: Validator;

  beforeEach(async () => {
    cleanup();
    store = new SQLiteStore(TEST_DB);
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    cleanup();
  });

  describe('Policy gate — validateTransaction', () => {
    const TX: RawTransaction = {
      to: '0xabc', data: '0x1234', value: '0', chainId: 1, from: '0x123',
    };

    it('approves a valid transaction', async () => {
      validator = new Validator(createMockProvider(), POLICY, store);
      const result = await validator.validateTransaction(TX);
      expect(result.approved).toBe(true);
      expect(result.checks.every((c) => c.status !== 'fail')).toBe(true);
    });

    it('rejects when simulation fails', async () => {
      const mock = createMockProvider({
        txSimulate: async () => ({ success: false, error: 'execution reverted' }),
      });
      validator = new Validator(mock, POLICY, store);
      const result = await validator.validateTransaction(TX);
      expect(result.approved).toBe(false);
      expect(result.checks.find((c) => c.rule === 'simulation')?.status).toBe('fail');
    });

    it('rejects when contract is unverified', async () => {
      const mock = createMockProvider({
        txVerify: async () => ({ verified: false, error: 'not verified' }),
      });
      validator = new Validator(mock, POLICY, store);
      const result = await validator.validateTransaction(TX);
      expect(result.approved).toBe(false);
      expect(result.checks.find((c) => c.rule === 'contractVerified')?.status).toBe('fail');
    });

    it('rejects when guard rules fail', async () => {
      const mock = createMockProvider({
        txGuard: async () => ({ passed: false, failedRules: ['maxGasLimit'], details: {} }),
      });
      validator = new Validator(mock, POLICY, store);
      const result = await validator.validateTransaction(TX);
      expect(result.approved).toBe(false);
      expect(result.checks.find((c) => c.rule === 'guardRules')?.status).toBe('fail');
    });

    it('skips balance check when no from address', async () => {
      validator = new Validator(createMockProvider(), POLICY, store);
      const noFrom: RawTransaction = { to: '0xabc', data: '0x1234', value: '0', chainId: 1 };
      const result = await validator.validateTransaction(noFrom);
      expect(result.approved).toBe(true);
      expect(result.checks.find((c) => c.rule === 'balance')?.status).toBe('skip');
    });
  });

  describe('Strategy validation — validateStrategy', () => {
    it('approves a valid carry strategy', async () => {
      validator = new Validator(createMockProvider(), POLICY, store);
      const result = await validator.validateStrategy({
        type: 'carry',
        collateral: 'tBTC',
        collateralAmount: 2,
        borrowAsset: 'USDC',
        targetLTV: 35,
        deployTo: 'aave-v3-usdc-supply',
      });
      expect(result.approved).toBe(true);
    });

    it('rejects protocol not in whitelist', async () => {
      validator = new Validator(createMockProvider(), POLICY, store);
      const result = await validator.validateStrategy({
        type: 'carry',
        collateral: 'tBTC',
        collateralAmount: 2,
        borrowAsset: 'USDC',
        targetLTV: 35,
        deployTo: 'compound-v3-usdc',
        protocol: 'compound-v3',
      });
      expect(result.approved).toBe(false);
      expect(result.checks.find((c) => c.rule === 'protocolWhitelist')?.status).toBe('fail');
    });

    it('rejects when LTV exceeds user max', async () => {
      validator = new Validator(createMockProvider(), POLICY, store);
      const result = await validator.validateStrategy({
        type: 'carry',
        collateral: 'tBTC',
        collateralAmount: 2,
        borrowAsset: 'USDC',
        targetLTV: 50,
        deployTo: 'aave-v3-usdc-supply',
      });
      expect(result.approved).toBe(false);
      expect(result.checks.find((c) => c.rule === 'portfolioBounds')?.status).toBe('fail');
    });

    it('rejects when health factor below user floor', async () => {
      const mock = createMockProvider({
        riskAssess: async () => ({
          healthFactor: 1.2, liquidationPrice: 60000, currentPrice: 82500,
          maxBorrow: 50000, protocol: 'aave-v3', risk: 'high',
        }),
      });
      validator = new Validator(mock, POLICY, store);
      const result = await validator.validateStrategy({
        type: 'carry',
        collateral: 'tBTC',
        collateralAmount: 2,
        borrowAsset: 'USDC',
        targetLTV: 35,
        deployTo: 'aave-v3-usdc-supply',
      });
      expect(result.approved).toBe(false);
      expect(result.checks.find((c) => c.rule === 'healthFactor')?.status).toBe('fail');
    });
  });
});
