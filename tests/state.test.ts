import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStore } from '../src/state.js';
import { unlinkSync, existsSync } from 'node:fs';

const TEST_DB = './__test_basalt.db';

let store: SQLiteStore;

function cleanup(): void {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

describe('SQLiteStore', () => {
  beforeEach(async () => {
    cleanup();
    store = new SQLiteStore(TEST_DB);
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    cleanup();
  });

  describe('positions', () => {
    it('adds and retrieves a position', async () => {
      const id = await store.addPosition({
        protocol: 'aave-v3',
        chain: 'ethereum',
        asset: 'tBTC',
        amount: 2.0,
        side: 'collateral',
        entryTime: new Date().toISOString(),
        status: 'active',
      });
      expect(id).toBeGreaterThan(0);

      const positions = await store.getPositions();
      expect(positions).toHaveLength(1);
      expect(positions[0].protocol).toBe('aave-v3');
      expect(positions[0].asset).toBe('tBTC');
      expect(positions[0].amount).toBe(2.0);
    });

    it('filters by status', async () => {
      await store.addPosition({
        protocol: 'aave-v3', chain: 'ethereum', asset: 'tBTC',
        amount: 1, side: 'collateral', entryTime: new Date().toISOString(), status: 'active',
      });
      await store.addPosition({
        protocol: 'aave-v3', chain: 'ethereum', asset: 'USDC',
        amount: 1000, side: 'borrow', entryTime: new Date().toISOString(), status: 'closed',
      });

      const active = await store.getPositions({ status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0].asset).toBe('tBTC');
    });

    it('filters by side', async () => {
      await store.addPosition({
        protocol: 'aave-v3', chain: 'ethereum', asset: 'tBTC',
        amount: 1, side: 'collateral', entryTime: new Date().toISOString(), status: 'active',
      });
      await store.addPosition({
        protocol: 'aave-v3', chain: 'ethereum', asset: 'USDC',
        amount: 1000, side: 'borrow', entryTime: new Date().toISOString(), status: 'active',
      });

      const borrows = await store.getPositions({ side: 'borrow' });
      expect(borrows).toHaveLength(1);
      expect(borrows[0].asset).toBe('USDC');
    });

    it('updates position status', async () => {
      const id = await store.addPosition({
        protocol: 'aave-v3', chain: 'ethereum', asset: 'tBTC',
        amount: 1, side: 'collateral', entryTime: new Date().toISOString(), status: 'active',
      });

      await store.updatePositionStatus(id, 'closed');
      const positions = await store.getPositions({ status: 'closed' });
      expect(positions).toHaveLength(1);
    });
  });

  describe('snapshots', () => {
    it('adds and retrieves snapshots', async () => {
      await store.addSnapshot({
        timestamp: new Date().toISOString(),
        totalCollateralUSD: 165000,
        totalBorrowedUSD: 57750,
        totalDeployedUSD: 57750,
        netValueUSD: 107250,
        aggregateLTV: 35,
        healthFactor: 2.3,
      });

      const latest = await store.getLatestSnapshot();
      expect(latest).not.toBeNull();
      expect(latest!.healthFactor).toBe(2.3);
      expect(latest!.aggregateLTV).toBe(35);
    });
  });

  describe('activity log', () => {
    it('adds and retrieves activities', async () => {
      await store.addActivity({
        timestamp: new Date().toISOString(),
        source: 'agent',
        actionType: 'validate',
        detail: { type: 'carry', approved: true },
      });

      const activities = await store.getActivity();
      expect(activities).toHaveLength(1);
      expect(activities[0].source).toBe('agent');
      expect(activities[0].detail).toEqual({ type: 'carry', approved: true });
    });
  });

  describe('risk events', () => {
    it('adds and retrieves risk events', async () => {
      await store.addRiskEvent({
        timestamp: new Date().toISOString(),
        severity: 'warning',
        healthFactor: 1.4,
        actionTaken: 'deleverage 20%',
        txHashes: [],
      });

      const events = await store.getRiskEvents();
      expect(events).toHaveLength(1);
      expect(events[0].severity).toBe('warning');
      expect(events[0].healthFactor).toBe(1.4);
    });
  });

  describe('policy config', () => {
    it('saves and retrieves policy', async () => {
      const policy = {
        maxLTV: 40,
        healthFactorFloor: 1.5,
        emergencyHealthFactor: 1.2,
        maxPositionUSD: 100000,
        minProfitOverGasMultiple: 2.0,
        deleveragePercent: 20,
        allowedProtocols: ['aave-v3'],
        monitorIntervalMinutes: 5,
      };
      await store.savePolicy(policy);

      const saved = await store.getPolicy();
      expect(saved).toEqual(policy);
    });
  });

  describe('portfolio', () => {
    it('returns aggregated portfolio', async () => {
      await store.addPosition({
        protocol: 'aave-v3', chain: 'ethereum', asset: 'tBTC',
        amount: 2, side: 'collateral', entryTime: new Date().toISOString(), status: 'active',
      });
      await store.addPosition({
        protocol: 'aave-v3', chain: 'ethereum', asset: 'USDC',
        amount: 57750, side: 'borrow', entryTime: new Date().toISOString(), status: 'active',
      });

      const portfolio = await store.getPortfolio();
      expect(portfolio.collateral).toHaveLength(1);
      expect(portfolio.borrows).toHaveLength(1);
      expect(portfolio.deployments).toHaveLength(0);
    });
  });
});
