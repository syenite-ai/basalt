import { describe, it, expect } from 'vitest';
import { SyeniteProvider } from '../src/providers/syenite.js';

describe('SyeniteProvider', () => {
  it('initializes with url and apiKey', () => {
    const provider = new SyeniteProvider({
      url: 'https://syenite.ai/mcp',
      apiKey: 'test-key',
    });
    expect(provider).toBeDefined();
  });

  it('tracks costs starting at zero', () => {
    const provider = new SyeniteProvider({ url: 'https://syenite.ai/mcp' });
    const costs = provider.getCosts();
    expect(costs.calls).toBe(0);
    expect(costs.estimatedUSDC).toBe(0);
  });

  it('resets costs', () => {
    const provider = new SyeniteProvider({ url: 'https://syenite.ai/mcp' });
    provider.resetCosts();
    const costs = provider.getCosts();
    expect(costs.calls).toBe(0);
    expect(costs.estimatedUSDC).toBe(0);
  });

  // Integration tests with live Syenite are not run in CI.
  // These test the interface contract only.
  it('implements all DataProvider methods', () => {
    const provider = new SyeniteProvider({ url: 'https://syenite.ai/mcp' });
    expect(typeof provider.txSimulate).toBe('function');
    expect(typeof provider.txVerify).toBe('function');
    expect(typeof provider.txGuard).toBe('function');
    expect(typeof provider.riskAssess).toBe('function');
    expect(typeof provider.positionMonitor).toBe('function');
    expect(typeof provider.carryScreen).toBe('function');
    expect(typeof provider.gasEstimate).toBe('function');
    expect(typeof provider.walletBalances).toBe('function');
  });
});
