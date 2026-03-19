import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RiskMonitor } from '../src/risk-monitor.js';
import { SQLiteStore } from '../src/state.js';
import { Notifier } from '../src/notifications.js';
import { unlinkSync, existsSync } from 'node:fs';
import type { DataProvider, PolicyConfig, RiskEvent } from '../src/types.js';

const TEST_DB = './__test_risk_monitor.db';

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
  monitorIntervalMinutes: 1,
};

function createMockProvider(healthFactor: number | null): DataProvider {
  return {
    txSimulate: async () => ({ success: true }),
    txVerify: async () => ({ verified: true }),
    txGuard: async () => ({ passed: true, failedRules: [], details: {} }),
    riskAssess: async () => ({
      healthFactor: healthFactor ?? 0, liquidationPrice: 42000, currentPrice: 82500,
      maxBorrow: 100000, protocol: 'aave-v3', risk: 'low',
    }),
    positionMonitor: async () => ({
      positions: [{
        protocol: 'aave-v3', chain: 'ethereum',
        healthFactor, totalCollateralUSD: 165000, totalBorrowedUSD: 57750, ltv: 35,
      }],
    }),
    carryScreen: async () => ({ strategies: [] }),
    gasEstimate: async () => ({ chain: 'ethereum', gasPrice: '30', estimates: {} }),
    walletBalances: async () => ({
      address: '0x123', balances: [],
    }),
  };
}

describe('RiskMonitor', () => {
  let store: SQLiteStore;
  let notifier: Notifier;

  beforeEach(async () => {
    cleanup();
    store = new SQLiteStore(TEST_DB);
    await store.init();
    notifier = new Notifier();
  });

  afterEach(async () => {
    await store.close();
    cleanup();
  });

  it('reports safe when HF > floor', async () => {
    const monitor = new RiskMonitor(createMockProvider(2.3), POLICY, store, notifier);
    monitor.setWalletAddress('0x123');

    const result = await monitor.checkRisk();
    expect(result.overallStatus).toBe('safe');
    expect(result.positions[0].status).toBe('safe');
  });

  it('reports warning when floor > HF > emergency', async () => {
    const monitor = new RiskMonitor(createMockProvider(1.3), POLICY, store, notifier);
    monitor.setWalletAddress('0x123');

    const result = await monitor.checkRisk();
    expect(result.overallStatus).toBe('warning');
    expect(result.positions[0].status).toBe('warning');
  });

  it('reports critical when HF <= emergency', async () => {
    const monitor = new RiskMonitor(createMockProvider(1.1), POLICY, store, notifier);
    monitor.setWalletAddress('0x123');

    const result = await monitor.checkRisk();
    expect(result.overallStatus).toBe('critical');
    expect(result.positions[0].status).toBe('critical');
  });

  it('reports no_positions when no wallet set', async () => {
    const monitor = new RiskMonitor(createMockProvider(2.0), POLICY, store, notifier);

    const result = await monitor.checkRisk();
    expect(result.overallStatus).toBe('no_positions');
  });

  it('calls custom risk event handlers', async () => {
    const monitor = new RiskMonitor(createMockProvider(1.3), POLICY, store, notifier);
    monitor.setWalletAddress('0x123');

    const events: RiskEvent[] = [];
    monitor.onRiskEvent((e) => { events.push(e); });

    // Trigger a tick manually by calling checkRisk and then examining state
    // We need to use the internal tick method — simulate by starting and stopping quickly
    monitor.start();
    // Wait for first tick
    await new Promise((r) => setTimeout(r, 200));
    monitor.stop();

    // Check that risk events were logged
    const riskEvents = await store.getRiskEvents();
    expect(riskEvents.length).toBeGreaterThan(0);
    expect(riskEvents[0].severity).toBe('warning');
  });

  it('enforces user-configured thresholds exactly', async () => {
    // User sets emergency at 1.01 — Basalt enforces 1.01
    const customPolicy = { ...POLICY, emergencyHealthFactor: 1.01, healthFactorFloor: 1.05 };
    const monitor = new RiskMonitor(createMockProvider(1.03), customPolicy, store, notifier);
    monitor.setWalletAddress('0x123');

    const result = await monitor.checkRisk();
    expect(result.positions[0].status).toBe('warning');

    // At 1.0, should be critical
    const monitor2 = new RiskMonitor(createMockProvider(1.0), customPolicy, store, notifier);
    monitor2.setWalletAddress('0x123');
    const result2 = await monitor2.checkRisk();
    expect(result2.positions[0].status).toBe('critical');
  });
});
