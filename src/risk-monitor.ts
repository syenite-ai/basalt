import type {
  DataProvider,
  PolicyConfig,
  RiskEvent,
  RiskEventHandler,
  RiskCheckResult,
} from './types.js';
import type { StateStore } from './state.js';
import { Notifier } from './notifications.js';

export class RiskMonitor {
  private interval: ReturnType<typeof setInterval> | null = null;
  private handlers: RiskEventHandler[] = [];
  private walletAddress: string | null = null;

  constructor(
    private provider: DataProvider,
    private policy: PolicyConfig,
    private state: StateStore,
    private notifier: Notifier,
  ) {}

  setWalletAddress(address: string): void {
    this.walletAddress = address;
  }

  onRiskEvent(handler: RiskEventHandler): void {
    this.handlers.push(handler);
  }

  start(): void {
    if (this.interval) return;

    const ms = this.policy.monitorIntervalMinutes * 60 * 1000;
    console.log(`[basalt:risk-monitor] Starting — checking every ${this.policy.monitorIntervalMinutes} min`);

    // Run immediately on start, then on interval
    this.tick().catch((err) => console.error('[basalt:risk-monitor] tick error:', err));
    this.interval = setInterval(() => {
      this.tick().catch((err) => console.error('[basalt:risk-monitor] tick error:', err));
    }, ms);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log('[basalt:risk-monitor] Stopped');
    }
  }

  async checkRisk(): Promise<RiskCheckResult> {
    if (!this.walletAddress) {
      return { positions: [], overallStatus: 'no_positions' };
    }

    try {
      const data = await this.provider.positionMonitor({
        address: this.walletAddress,
        protocol: 'all',
        chain: 'all',
      });

      if (data.positions.length === 0) {
        return { positions: [], overallStatus: 'no_positions' };
      }

      const results: RiskCheckResult['positions'] = data.positions.map((p) => {
        let status: 'safe' | 'warning' | 'critical' | 'unknown' = 'unknown';
        if (p.healthFactor === null) {
          status = 'unknown';
        } else if (p.healthFactor <= this.policy.emergencyHealthFactor) {
          status = 'critical';
        } else if (p.healthFactor <= this.policy.healthFactorFloor) {
          status = 'warning';
        } else {
          status = 'safe';
        }

        return {
          protocol: p.protocol,
          chain: p.chain,
          healthFactor: p.healthFactor,
          status,
        };
      });

      const hasEmergency = results.some((r) => r.status === 'critical');
      const hasWarning = results.some((r) => r.status === 'warning');

      return {
        positions: results,
        overallStatus: hasEmergency ? 'critical' : hasWarning ? 'warning' : 'safe',
      };
    } catch (err) {
      console.error('[basalt:risk-monitor] Error checking positions:', (err as Error).message);
      return { positions: [], overallStatus: 'no_positions' };
    }
  }

  // -------------------------------------------------------------------------
  // Internal tick — runs every N minutes
  // -------------------------------------------------------------------------

  private async tick(): Promise<void> {
    const result = await this.checkRisk();

    if (result.overallStatus === 'no_positions') return;

    // Snapshot current state
    const snapshot = this.buildSnapshot(result);
    if (snapshot) {
      await this.state.addSnapshot(snapshot);
    }

    for (const pos of result.positions) {
      if (pos.status === 'safe') continue;

      const event: Omit<RiskEvent, 'id'> = {
        timestamp: new Date().toISOString(),
        severity: pos.status === 'critical' ? 'emergency' : 'warning',
        healthFactor: pos.healthFactor ?? 0,
        actionTaken: this.describeAction(pos.status),
        txHashes: [],
      };

      await this.state.addRiskEvent(event);
      await this.notifier.sendRiskEvent(event as RiskEvent);

      for (const handler of this.handlers) {
        try {
          await handler(event as RiskEvent);
        } catch (err) {
          console.error('[basalt:risk-monitor] Handler error:', (err as Error).message);
        }
      }

      // Phase 1: log what we WOULD do, but don't execute
      await this.state.addActivity({
        timestamp: new Date().toISOString(),
        source: 'risk_monitor',
        actionType: pos.status === 'critical' ? 'unwind' : 'deleverage',
        detail: {
          mode: 'logs_only',
          protocol: pos.protocol,
          chain: pos.chain,
          healthFactor: pos.healthFactor,
          wouldDeleverage: pos.status === 'warning' ? `${this.policy.deleveragePercent}%` : 'full unwind',
        },
      });
    }
  }

  private describeAction(status: string): string {
    if (status === 'critical') return `EMERGENCY — would unwind all positions (Phase 1: logs only)`;
    if (status === 'warning') return `WARNING — would deleverage ${this.policy.deleveragePercent}% (Phase 1: logs only)`;
    return 'no action';
  }

  private buildSnapshot(result: RiskCheckResult) {
    // Simplified snapshot from position monitor data
    if (result.positions.length === 0) return null;

    const avgHF = result.positions.reduce((sum, p) => sum + (p.healthFactor ?? 0), 0) / result.positions.length;

    return {
      timestamp: new Date().toISOString(),
      totalCollateralUSD: 0,
      totalBorrowedUSD: 0,
      totalDeployedUSD: 0,
      netValueUSD: 0,
      aggregateLTV: 0,
      healthFactor: avgHF,
    };
  }
}
