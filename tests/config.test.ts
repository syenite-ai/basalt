import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../src/config.js';

const TMP_CONFIG = resolve(process.cwd(), '__test_basalt_config.json');

function writeConfig(obj: unknown): void {
  writeFileSync(TMP_CONFIG, JSON.stringify(obj, null, 2));
}

function cleanup(): void {
  if (existsSync(TMP_CONFIG)) unlinkSync(TMP_CONFIG);
}

const VALID_CONFIG = {
  provider: { type: 'syenite', url: 'https://syenite.ai/mcp' },
  policy: {
    maxLTV: 40,
    healthFactorFloor: 1.5,
    emergencyHealthFactor: 1.2,
    maxPositionUSD: 100000,
    minProfitOverGasMultiple: 2.0,
    deleveragePercent: 20,
    allowedProtocols: ['aave-v3'],
    monitorIntervalMinutes: 5,
  },
};

describe('config', () => {
  afterEach(cleanup);

  it('loads a valid config', () => {
    writeConfig(VALID_CONFIG);
    const config = loadConfig(TMP_CONFIG);
    expect(config.policy.maxLTV).toBe(40);
    expect(config.policy.allowedProtocols).toEqual(['aave-v3']);
  });

  it('refuses to start when config file is missing', () => {
    expect(() => loadConfig('/tmp/__nonexistent_basalt_config.json'))
      .toThrow('Config file not found');
  });

  it('refuses to start when policy.maxLTV is missing', () => {
    const broken = { ...VALID_CONFIG, policy: { ...VALID_CONFIG.policy, maxLTV: undefined } };
    writeConfig(broken);
    expect(() => loadConfig(TMP_CONFIG)).toThrow('Missing or invalid policy parameters');
  });

  it('refuses to start when policy.healthFactorFloor is missing', () => {
    const broken = { ...VALID_CONFIG, policy: { ...VALID_CONFIG.policy, healthFactorFloor: undefined } };
    writeConfig(broken);
    expect(() => loadConfig(TMP_CONFIG)).toThrow('Missing or invalid policy parameters');
  });

  it('refuses to start when policy.allowedProtocols is empty', () => {
    const broken = { ...VALID_CONFIG, policy: { ...VALID_CONFIG.policy, allowedProtocols: [] } };
    writeConfig(broken);
    expect(() => loadConfig(TMP_CONFIG)).toThrow('Missing or invalid policy parameters');
  });

  it('refuses to start when emergencyHF >= healthFactorFloor', () => {
    const broken = { ...VALID_CONFIG, policy: { ...VALID_CONFIG.policy, emergencyHealthFactor: 1.5 } };
    writeConfig(broken);
    expect(() => loadConfig(TMP_CONFIG)).toThrow('emergencyHealthFactor');
  });

  it('rejects maxLTV > 100', () => {
    const broken = { ...VALID_CONFIG, policy: { ...VALID_CONFIG.policy, maxLTV: 150 } };
    writeConfig(broken);
    expect(() => loadConfig(TMP_CONFIG)).toThrow('Missing or invalid policy parameters');
  });

  it('rejects negative healthFactorFloor', () => {
    const broken = { ...VALID_CONFIG, policy: { ...VALID_CONFIG.policy, healthFactorFloor: -1 } };
    writeConfig(broken);
    expect(() => loadConfig(TMP_CONFIG)).toThrow('Missing or invalid policy parameters');
  });

  it('substitutes environment variables', () => {
    process.env.__TEST_SYENITE_URL = 'https://test.syenite.ai/mcp';
    const cfg = {
      ...VALID_CONFIG,
      provider: { type: 'syenite', url: '${__TEST_SYENITE_URL}' },
    };
    writeConfig(cfg);
    const config = loadConfig(TMP_CONFIG);
    expect(config.provider.url).toBe('https://test.syenite.ai/mcp');
    delete process.env.__TEST_SYENITE_URL;
  });

  it('strips _WARNING and _NOTE metadata keys', () => {
    const cfg = {
      _WARNING: 'EXAMPLE ONLY',
      ...VALID_CONFIG,
      policy: { _NOTE: 'fill in your own', ...VALID_CONFIG.policy },
    };
    writeConfig(cfg);
    const config = loadConfig(TMP_CONFIG);
    expect(config.policy.maxLTV).toBe(40);
  });
});
