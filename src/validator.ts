import type {
  DataProvider,
  PolicyConfig,
  RawTransaction,
  ValidationResult,
  CheckResult,
  StrategyProposal,
  GuardRules,
} from './types.js';
import type { StateStore } from './state.js';

export class Validator {
  constructor(
    private provider: DataProvider,
    private policy: PolicyConfig,
    private state: StateStore,
  ) {}

  // -------------------------------------------------------------------------
  // Mode 1: Policy gate — validate ANY raw tx from ANY source
  // -------------------------------------------------------------------------

  async validateTransaction(tx: RawTransaction): Promise<ValidationResult> {
    const checks: CheckResult[] = [];

    // 1. Simulate
    try {
      const sim = await this.provider.txSimulate(tx);
      checks.push({
        rule: 'simulation',
        status: sim.success ? 'pass' : 'fail',
        detail: sim.success
          ? `tx succeeds${sim.gasUsed ? `, gas: ${sim.gasUsed}` : ''}`
          : `tx reverts: ${sim.error ?? 'unknown'}`,
      });
    } catch (err) {
      checks.push({ rule: 'simulation', status: 'fail', detail: `simulation error: ${(err as Error).message}` });
    }

    // 2. Contract verification
    try {
      const verify = await this.provider.txVerify(tx);
      checks.push({
        rule: 'contractVerified',
        status: verify.verified ? 'pass' : 'fail',
        detail: verify.verified
          ? `source verified${verify.contractName ? `: ${verify.contractName}` : ''}`
          : `contract not verified: ${verify.error ?? 'unverified'}`,
      });
    } catch (err) {
      checks.push({ rule: 'contractVerified', status: 'fail', detail: `verification error: ${(err as Error).message}` });
    }

    // 3. Guard rules from user policy
    const guardRules: GuardRules = {
      allowedContracts: this.resolveAllowedContracts(),
      requireVerifiedContract: true,
    };

    try {
      const guard = await this.provider.txGuard(tx, guardRules);
      checks.push({
        rule: 'guardRules',
        status: guard.passed ? 'pass' : 'fail',
        detail: guard.passed
          ? 'all guard rules pass'
          : `failed rules: ${guard.failedRules.join(', ')}`,
      });
    } catch (err) {
      checks.push({ rule: 'guardRules', status: 'fail', detail: `guard error: ${(err as Error).message}` });
    }

    // 4. Balance check (if from address available)
    if (tx.from) {
      try {
        const balances = await this.provider.walletBalances({ address: tx.from });
        const hasBalance = balances.balances.length > 0;
        checks.push({
          rule: 'balance',
          status: hasBalance ? 'pass' : 'fail',
          detail: hasBalance ? 'wallet has balances' : 'no balances found',
        });
      } catch (err) {
        checks.push({ rule: 'balance', status: 'skip', detail: `balance check skipped: ${(err as Error).message}` });
      }
    } else {
      checks.push({ rule: 'balance', status: 'skip', detail: 'no from address provided — balance check skipped' });
    }

    const failed = checks.filter((c) => c.status === 'fail');
    return {
      approved: failed.length === 0,
      checks,
      rejectionReason: failed.length > 0
        ? failed.map((c) => c.detail).join('; ')
        : undefined,
    };
  }

  // -------------------------------------------------------------------------
  // Mode 2: Strategy validation — richer pre-flight via DataProvider
  // -------------------------------------------------------------------------

  async validateStrategy(proposal: StrategyProposal): Promise<ValidationResult> {
    const checks: CheckResult[] = [];

    // 1. Protocol whitelist
    const protocol = proposal.protocol ?? '';
    const target = (proposal.deployTo ?? protocol).toLowerCase();
    const protoAllowed = this.policy.allowedProtocols.some(
      (p) => target.startsWith(p.toLowerCase()) || protocol.toLowerCase() === p.toLowerCase(),
    );
    checks.push({
      rule: 'protocolWhitelist',
      status: protoAllowed ? 'pass' : 'fail',
      detail: protoAllowed
        ? `${protocol} in YOUR allowedProtocols`
        : `${protocol} not in YOUR allowedProtocols [${this.policy.allowedProtocols.join(', ')}]`,
    });

    // 2. Position size limit (estimate based on collateral)
    // We don't know exact USD value without a price feed, so use provider if carry type
    if (proposal.type === 'carry' && proposal.borrowAsset && proposal.targetLTV) {
      try {
        const risk = await this.provider.riskAssess({
          collateral: proposal.collateral,
          collateralAmount: proposal.collateralAmount,
          borrowAsset: proposal.borrowAsset,
          targetLTV: proposal.targetLTV,
          protocol: proposal.protocol,
        });

        // Health factor check
        checks.push({
          rule: 'healthFactor',
          status: risk.healthFactor >= this.policy.healthFactorFloor ? 'pass' : 'fail',
          detail: `resulting HF ${risk.healthFactor.toFixed(2)} ${risk.healthFactor >= this.policy.healthFactorFloor ? '≥' : '<'} YOUR floor ${this.policy.healthFactorFloor}`,
        });

        // LTV bounds check
        const resultingLTV = proposal.targetLTV;
        checks.push({
          rule: 'portfolioBounds',
          status: resultingLTV <= this.policy.maxLTV ? 'pass' : 'fail',
          detail: `resulting LTV ${resultingLTV}% ${resultingLTV <= this.policy.maxLTV ? '≤' : '>'} YOUR max ${this.policy.maxLTV}%`,
        });
      } catch (err) {
        checks.push({ rule: 'healthFactor', status: 'fail', detail: `risk assessment error: ${(err as Error).message}` });
        checks.push({ rule: 'portfolioBounds', status: 'skip', detail: 'skipped — risk assessment failed' });
      }

      // 3. Profitability after gas
      try {
        const [carry, gas] = await Promise.all([
          this.provider.carryScreen({
            collateral: proposal.collateral,
            borrowAsset: proposal.borrowAsset,
          }),
          this.provider.gasEstimate({ operations: ['lending_supply', 'lending_borrow'] }),
        ]);

        const bestMatch = carry.strategies.find((s) =>
          proposal.deployTo ? s.market.includes(proposal.deployTo) : true,
        ) ?? carry.strategies[0];

        if (bestMatch) {
          const totalGasCostUSD = Object.values(gas.estimates).reduce((sum, e) => sum + e.costUSD, 0);
          const netCarryValue = bestMatch.netCarry;
          const gasMultiple = totalGasCostUSD > 0 ? netCarryValue / totalGasCostUSD : Infinity;

          checks.push({
            rule: 'profitability',
            status: gasMultiple >= this.policy.minProfitOverGasMultiple ? 'pass' : 'fail',
            detail: `${bestMatch.netCarry.toFixed(2)}% net carry, gas multiple ${gasMultiple.toFixed(1)}x ${gasMultiple >= this.policy.minProfitOverGasMultiple ? '≥' : '<'} YOUR min ${this.policy.minProfitOverGasMultiple}x`,
          });
        } else {
          checks.push({ rule: 'profitability', status: 'fail', detail: 'no matching carry strategies found' });
        }
      } catch (err) {
        checks.push({ rule: 'profitability', status: 'fail', detail: `profitability check error: ${(err as Error).message}` });
      }
    }

    const failed = checks.filter((c) => c.status === 'fail');
    return {
      approved: failed.length === 0,
      checks,
      rejectionReason: failed.length > 0
        ? failed.map((c) => c.detail).join('; ')
        : undefined,
    };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private resolveAllowedContracts(): string[] | undefined {
    // In a full implementation, this would resolve protocol names to contract addresses.
    // For now, we return undefined (no contract-level allowlist enforcement via guard).
    return undefined;
  }
}
