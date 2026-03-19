import type {
  DataProvider,
  PolicyConfig,
  CarryParams,
  ExecutionResult,
  TransactionStep,
  RawTransaction,
} from './types.js';
import type { Validator } from './validator.js';
import type { StateStore } from './state.js';

export class Orchestrator {
  constructor(
    private provider: DataProvider,
    private policy: PolicyConfig,
    private validator: Validator,
    private state: StateStore,
  ) {}

  // -------------------------------------------------------------------------
  // Carry trade sequence
  // -------------------------------------------------------------------------

  async buildCarrySequence(params: CarryParams): Promise<ExecutionResult> {
    // Pre-flight: validate the strategy against user policy
    const strategyCheck = await this.validator.validateStrategy({
      type: 'carry',
      collateral: params.collateral,
      collateralAmount: params.collateralAmount,
      borrowAsset: params.borrowAsset,
      targetLTV: params.targetLTV,
      deployTo: params.deployTo,
    });

    if (!strategyCheck.approved) {
      await this.state.addActivity({
        timestamp: new Date().toISOString(),
        source: 'agent',
        actionType: 'rejection',
        detail: { type: 'carry', params, checks: strategyCheck.checks },
      });
      return {
        status: 'rejected',
        steps: [],
        rejectionReason: strategyCheck.rejectionReason,
      };
    }

    // Build the step sequence (dry_run — no real calldata until lending tools ship)
    const steps: TransactionStep[] = [
      this.buildStep('approve_collateral', `Approve ${params.collateral} for ${params.deployTo}`),
      this.buildStep('supply_collateral', `Supply ${params.collateralAmount} ${params.collateral} to ${params.deployTo}`),
      this.buildStep('borrow', `Borrow ${params.borrowAsset} at ${params.targetLTV}% LTV`),
      this.buildStep('approve_borrow', `Approve ${params.borrowAsset} for yield deployment`),
      this.buildStep('deploy_yield', `Deploy ${params.borrowAsset} to yield on ${params.deployTo}`),
    ];

    // Validate each step through the policy gate (with placeholder txs in dry_run)
    for (const step of steps) {
      const txCheck = await this.validator.validateTransaction(step.tx);
      step.policyCheck = txCheck;
      if (!txCheck.approved) {
        step.status = 'failed';
        await this.state.addActivity({
          timestamp: new Date().toISOString(),
          source: 'agent',
          actionType: 'rejection',
          detail: { type: 'carry_step', action: step.action, checks: txCheck.checks },
        });

        return {
          status: 'rejected',
          steps,
          rejectionReason: `Step "${step.action}" rejected: ${txCheck.rejectionReason}`,
        };
      }
      step.status = 'validated';
    }

    await this.state.addActivity({
      timestamp: new Date().toISOString(),
      source: 'agent',
      actionType: 'execute',
      detail: { type: 'carry', params, mode: 'dry_run', steps: steps.length },
    });

    return {
      status: 'dry_run',
      steps,
      costs: { providerCalls: 0, estimatedUSDC: 0 },
    };
  }

  // -------------------------------------------------------------------------
  // Deleverage sequence
  // -------------------------------------------------------------------------

  async buildDeleverageSequence(params: { percent: number; protocol?: string }): Promise<ExecutionResult> {
    const positions = await this.state.getPositions({ status: 'active', side: 'borrow' });
    if (positions.length === 0) {
      return { status: 'dry_run', steps: [], rejectionReason: 'no active borrow positions' };
    }

    const steps: TransactionStep[] = [];
    for (const pos of positions) {
      if (params.protocol && pos.protocol !== params.protocol) continue;

      const repayAmount = pos.amount * (params.percent / 100);
      steps.push(
        this.buildStep('approve_repay', `Approve ${repayAmount.toFixed(4)} ${pos.asset} for repay`),
        this.buildStep('repay', `Repay ${repayAmount.toFixed(4)} ${pos.asset} on ${pos.protocol}`),
      );
    }

    for (const step of steps) {
      const txCheck = await this.validator.validateTransaction(step.tx);
      step.policyCheck = txCheck;
      step.status = txCheck.approved ? 'validated' : 'failed';
    }

    await this.state.addActivity({
      timestamp: new Date().toISOString(),
      source: 'agent',
      actionType: 'deleverage',
      detail: { percent: params.percent, mode: 'dry_run', steps: steps.length },
    });

    return { status: 'dry_run', steps };
  }

  // -------------------------------------------------------------------------
  // Emergency unwind sequence
  // -------------------------------------------------------------------------

  async buildUnwindSequence(): Promise<ExecutionResult> {
    const borrows = await this.state.getPositions({ status: 'active', side: 'borrow' });
    const collateral = await this.state.getPositions({ status: 'active', side: 'collateral' });

    const steps: TransactionStep[] = [];

    // Repay all borrows first
    for (const pos of borrows) {
      steps.push(
        this.buildStep('approve_repay', `Approve ${pos.amount} ${pos.asset} for repay`),
        this.buildStep('repay_full', `Repay full ${pos.amount} ${pos.asset} on ${pos.protocol}`),
      );
    }

    // Withdraw all collateral
    for (const pos of collateral) {
      steps.push(
        this.buildStep('withdraw', `Withdraw ${pos.amount} ${pos.asset} from ${pos.protocol}`),
      );
    }

    for (const step of steps) {
      const txCheck = await this.validator.validateTransaction(step.tx);
      step.policyCheck = txCheck;
      step.status = txCheck.approved ? 'validated' : 'failed';
    }

    await this.state.addActivity({
      timestamp: new Date().toISOString(),
      source: 'agent',
      actionType: 'unwind',
      detail: { mode: 'dry_run', steps: steps.length },
    });

    return { status: 'dry_run', steps };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private buildStep(action: string, description: string): TransactionStep {
    // Placeholder tx — in Phase 2, DataProvider will generate real calldata
    const placeholderTx: RawTransaction = {
      to: '0x0000000000000000000000000000000000000000',
      data: '0x',
      value: '0',
      chainId: 1,
    };

    return {
      action,
      tx: placeholderTx,
      status: 'pending',
    };
  }
}
