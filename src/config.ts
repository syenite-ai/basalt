import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BasaltConfig } from './types.js';

const policySchema = z.object({
  maxLTV: z.number().min(0).max(100),
  healthFactorFloor: z.number().positive(),
  emergencyHealthFactor: z.number().positive(),
  maxPositionUSD: z.number().positive(),
  minProfitOverGasMultiple: z.number().positive(),
  deleveragePercent: z.number().min(0).max(100),
  allowedProtocols: z.array(z.string()).min(1),
  monitorIntervalMinutes: z.number().int().positive(),
});

const providerSchema = z.object({
  type: z.enum(['syenite', 'custom']).default('syenite'),
  url: z.string().min(1),
  apiKey: z.string().optional(),
});

const notificationsSchema = z.object({
  webhookUrl: z.string().optional(),
  onWarning: z.boolean().default(true),
  onCritical: z.boolean().default(true),
  onEmergency: z.boolean().default(true),
  onRejection: z.boolean().default(true),
}).optional();

const apiSchema = z.object({
  port: z.number().int().positive().default(3100),
  auth: z.string().optional(),
}).optional();

const configSchema = z.object({
  provider: providerSchema,
  wallet: z.object({ privateKey: z.string().min(1) }).optional(),
  database: z.object({ url: z.string().min(1) }).optional(),
  policy: policySchema,
  notifications: notificationsSchema,
  api: apiSchema,
});

function substituteEnvVars(raw: string): string {
  return raw.replace(/\$\{(\w+)\}/g, (_, key: string) => {
    return process.env[key] ?? '';
  });
}

function stripJsonComments(text: string): string {
  return text.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1');
}

export function loadConfig(configPath?: string): BasaltConfig {
  const resolved = configPath ?? resolve(process.cwd(), 'basalt.config.json');

  if (!existsSync(resolved)) {
    throw new Error(
      `Config file not found: ${resolved}\n` +
      'Run "npx basalt init" to generate a config template, then fill in YOUR policy parameters.',
    );
  }

  const raw = readFileSync(resolved, 'utf-8');
  const substituted = substituteEnvVars(raw);
  const cleaned = stripJsonComments(substituted);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Failed to parse config file: ${resolved}\n${(e as Error).message}`);
  }

  // Strip _WARNING / _NOTE metadata keys
  const obj = parsed as Record<string, unknown>;
  delete obj['_WARNING'];
  if (obj['policy'] && typeof obj['policy'] === 'object') {
    delete (obj['policy'] as Record<string, unknown>)['_NOTE'];
  }

  const result = configSchema.safeParse(obj);
  if (!result.success) {
    const missing = result.error.issues.map((i) => {
      const path = i.path.join('.');
      return `  - ${path}: ${i.message}`;
    });
    throw new Error(
      'Missing or invalid policy parameters. Basalt requires ALL policy parameters to be explicitly configured.\n' +
      'Basalt does not provide default values — you must choose your own.\n\n' +
      missing.join('\n'),
    );
  }

  const config = result.data as BasaltConfig;

  if (config.policy.emergencyHealthFactor >= config.policy.healthFactorFloor) {
    throw new Error(
      `emergencyHealthFactor (${config.policy.emergencyHealthFactor}) must be less than healthFactorFloor (${config.policy.healthFactorFloor}).`,
    );
  }

  return config;
}

export function logDisclaimer(): void {
  console.log(
    '\n' +
    '═══════════════════════════════════════════════════════════════\n' +
    '  Basalt — Policy Enforcement Runtime\n' +
    '  Running with YOUR configured policy.\n' +
    '  This software provides NO financial advice.\n' +
    '  You are solely responsible for your configuration.\n' +
    '═══════════════════════════════════════════════════════════════\n',
  );
}
