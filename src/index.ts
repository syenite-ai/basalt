import type {
  BasaltConfig,
  PolicyConfig,
  DataProvider,
  RawTransaction,
  StrategyProposal,
  CarryParams,
  ValidationResult,
  ExecutionResult,
  Portfolio,
  Position,
  ActivityEntry,
  RiskCheckResult,
  RiskEventHandler,
} from './types.js';
import { loadConfig, logDisclaimer } from './config.js';
import { SyeniteProvider } from './providers/syenite.js';
import { createStore, type StateStore } from './state.js';
import { Notifier } from './notifications.js';
import { Validator } from './validator.js';
import { Orchestrator } from './orchestrator.js';
import { RiskMonitor } from './risk-monitor.js';
import { createApi } from './api.js';
import { serve } from '@hono/node-server';
import { privateKeyToAccount } from 'viem/accounts';

export interface BasaltOptions {
  config?: BasaltConfig;
  configPath?: string;
  provider?: DataProvider;
}

export class Basalt {
  readonly config: BasaltConfig;
  readonly policy: PolicyConfig;
  readonly provider: DataProvider;
  readonly state: StateStore;
  readonly validator: Validator;
  readonly orchestrator: Orchestrator;
  readonly riskMonitor: RiskMonitor;

  private notifier: Notifier;
  private apiServer: ReturnType<typeof serve> | null = null;

  constructor(options: BasaltOptions) {
    this.config = options.config ?? loadConfig(options.configPath);
    this.policy = this.config.policy;

    this.provider = options.provider ?? new SyeniteProvider({
      url: this.config.provider.url,
      apiKey: this.config.provider.apiKey,
    });

    this.state = createStore(this.config.database?.url);
    this.notifier = new Notifier(this.config.notifications);
    this.validator = new Validator(this.provider, this.policy, this.state);
    this.orchestrator = new Orchestrator(this.provider, this.policy, this.validator, this.state);
    this.riskMonitor = new RiskMonitor(this.provider, this.policy, this.state, this.notifier);

    if (this.config.wallet?.privateKey) {
      try {
        const account = privateKeyToAccount(this.config.wallet.privateKey as `0x${string}`);
        this.riskMonitor.setWalletAddress(account.address);
      } catch {
        // Invalid key format — risk monitor won't have wallet context
      }
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    logDisclaimer();
    await this.state.init();
    await this.state.savePolicy(this.policy);
    console.log(`[basalt] Policy loaded: maxLTV=${this.policy.maxLTV}%, HF floor=${this.policy.healthFactorFloor}, protocols=[${this.policy.allowedProtocols.join(', ')}]`);
  }

  startRiskMonitor(): void {
    this.riskMonitor.start();
  }

  stopRiskMonitor(): void {
    this.riskMonitor.stop();
  }

  startRestApi(port?: number): void {
    const apiPort = port ?? this.config.api?.port ?? 3100;
    const app = createApi({
      validator: this.validator,
      orchestrator: this.orchestrator,
      riskMonitor: this.riskMonitor,
      state: this.state,
      policy: this.policy,
      authToken: this.config.api?.auth,
    });

    this.apiServer = serve({ fetch: app.fetch, port: apiPort });
    console.log(`[basalt:api] REST API listening on :${apiPort}`);
  }

  async stop(): Promise<void> {
    this.riskMonitor.stop();
    if (this.apiServer) {
      this.apiServer.close();
      this.apiServer = null;
    }
    await this.state.close();
  }

  // -------------------------------------------------------------------------
  // Policy gate
  // -------------------------------------------------------------------------

  async validateTransaction(tx: RawTransaction): Promise<ValidationResult> {
    return this.validator.validateTransaction(tx);
  }

  // -------------------------------------------------------------------------
  // Strategy validation
  // -------------------------------------------------------------------------

  async validateStrategy(proposal: StrategyProposal): Promise<ValidationResult> {
    return this.validator.validateStrategy(proposal);
  }

  // -------------------------------------------------------------------------
  // Orchestration (convenience)
  // -------------------------------------------------------------------------

  async buildCarrySequence(params: CarryParams): Promise<ExecutionResult> {
    return this.orchestrator.buildCarrySequence(params);
  }

  async buildDeleverageSequence(params: { percent: number; protocol?: string }): Promise<ExecutionResult> {
    return this.orchestrator.buildDeleverageSequence(params);
  }

  async buildUnwindSequence(): Promise<ExecutionResult> {
    return this.orchestrator.buildUnwindSequence();
  }

  // -------------------------------------------------------------------------
  // State reads
  // -------------------------------------------------------------------------

  async getPortfolio(): Promise<Portfolio> {
    return this.state.getPortfolio();
  }

  async getPositions(filter?: { status?: string; side?: string }): Promise<Position[]> {
    return this.state.getPositions(filter);
  }

  async getActivityLog(limit?: number): Promise<ActivityEntry[]> {
    return this.state.getActivity(limit);
  }

  // -------------------------------------------------------------------------
  // Risk
  // -------------------------------------------------------------------------

  async checkRisk(): Promise<RiskCheckResult> {
    return this.riskMonitor.checkRisk();
  }

  onRiskEvent(handler: RiskEventHandler): void {
    this.riskMonitor.onRiskEvent(handler);
  }

  // -------------------------------------------------------------------------
  // Cost tracking (SyeniteProvider only)
  // -------------------------------------------------------------------------

  getCostSummary(): { calls: number; estimatedUSDC: number } | null {
    if (this.provider instanceof SyeniteProvider) {
      return this.provider.getCosts();
    }
    return null;
  }
}

export { loadConfig, logDisclaimer } from './config.js';
export { SyeniteProvider } from './providers/syenite.js';
export { createStore, SQLiteStore } from './state.js';
export { Validator } from './validator.js';
export { Orchestrator } from './orchestrator.js';
export { RiskMonitor } from './risk-monitor.js';
export { Notifier } from './notifications.js';
export { createApi } from './api.js';

export type * from './types.js';
