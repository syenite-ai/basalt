import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  DataProvider,
  RawTransaction,
  GuardRules,
  TxSimulateResult,
  TxVerifyResult,
  TxGuardResult,
  RiskAssessResult,
  CarryScreenResult,
  GasEstimateResult,
  WalletBalancesResult,
  PositionMonitorResult,
} from '../types.js';

export interface SyeniteProviderOptions {
  url: string;
  apiKey?: string;
}

interface CostTracker {
  calls: number;
  estimatedUSDC: number;
}

const TOOL_COSTS: Record<string, number> = {
  'tx.simulate': 0.01,
  'tx.verify': 0.005,
  'tx.guard': 0.005,
  'lending.risk.assess': 0.01,
  'strategy.carry.screen': 0.01,
  'lending.position.monitor': 0,
  'gas.estimate': 0,
  'wallet.balances': 0,
};

export class SyeniteProvider implements DataProvider {
  private client: Client;
  private transport: StreamableHTTPClientTransport;
  private connected = false;
  private costs: CostTracker = { calls: 0, estimatedUSDC: 0 };

  constructor(private options: SyeniteProviderOptions) {
    const headers: Record<string, string> = {};
    if (options.apiKey) {
      headers['Authorization'] = `Bearer ${options.apiKey}`;
    }

    this.transport = new StreamableHTTPClientTransport(
      new URL(options.url),
      { requestInit: { headers } },
    );
    this.client = new Client({ name: 'basalt', version: '0.1.0' });
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.client.connect(this.transport);
      this.connected = true;
    }
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.ensureConnected();
    this.costs.calls++;
    this.costs.estimatedUSDC += TOOL_COSTS[name] ?? 0;

    const result = await this.client.callTool({ name, arguments: args });

    if (result.isError) {
      const contentArr = result.content as Array<{ text?: string }> | undefined;
      const msg = contentArr?.[0];
      throw new Error(`Syenite tool ${name} failed: ${msg?.text ?? 'unknown error'}`);
    }

    const contentArr = result.content as Array<{ text?: string }> | undefined;
    const content = contentArr?.[0];
    if (content?.text) {
      try {
        return JSON.parse(content.text);
      } catch {
        return content.text;
      }
    }
    return result.content;
  }

  getCosts(): CostTracker {
    return { ...this.costs };
  }

  resetCosts(): void {
    this.costs = { calls: 0, estimatedUSDC: 0 };
  }

  async txSimulate(tx: RawTransaction): Promise<TxSimulateResult> {
    const result = await this.callTool('tx.simulate', {
      transaction: {
        to: tx.to,
        data: tx.data,
        value: tx.value,
        from: tx.from ?? '0x0000000000000000000000000000000000000000',
        chainId: tx.chainId,
      },
      chain: String(tx.chainId),
    });
    return result as TxSimulateResult;
  }

  async txVerify(tx: RawTransaction): Promise<TxVerifyResult> {
    const chain = tx.chainId === 1 ? 'ethereum'
      : tx.chainId === 42161 ? 'arbitrum'
      : tx.chainId === 8453 ? 'base'
      : 'ethereum';

    const result = await this.callTool('tx.verify', {
      to: tx.to,
      chain,
      data: tx.data,
    });
    return result as TxVerifyResult;
  }

  async txGuard(tx: RawTransaction, rules: GuardRules): Promise<TxGuardResult> {
    const result = await this.callTool('tx.guard', {
      transaction: {
        to: tx.to,
        data: tx.data,
        value: tx.value,
        chainId: tx.chainId,
      },
      rules,
    });
    return result as TxGuardResult;
  }

  async riskAssess(params: {
    collateral: string;
    collateralAmount: number;
    borrowAsset?: string;
    targetLTV: number;
    protocol?: string;
  }): Promise<RiskAssessResult> {
    const result = await this.callTool('lending.risk.assess', {
      collateral: params.collateral,
      collateralAmount: params.collateralAmount,
      borrowAsset: params.borrowAsset ?? 'USDC',
      targetLTV: params.targetLTV,
      protocol: params.protocol ?? 'best',
    });
    return result as RiskAssessResult;
  }

  async positionMonitor(params: {
    address: string;
    protocol?: string;
    chain?: string;
  }): Promise<PositionMonitorResult> {
    const result = await this.callTool('lending.position.monitor', {
      address: params.address,
      protocol: params.protocol ?? 'all',
      chain: params.chain ?? 'all',
    });
    return result as PositionMonitorResult;
  }

  async carryScreen(params: {
    collateral?: string;
    borrowAsset?: string;
    chain?: string;
    minCarry?: number;
    positionSizeUSD?: number;
  }): Promise<CarryScreenResult> {
    const result = await this.callTool('strategy.carry.screen', {
      collateral: params.collateral ?? 'all',
      borrowAsset: params.borrowAsset ?? 'USDC',
      chain: params.chain ?? 'all',
      minCarry: params.minCarry,
      positionSizeUSD: params.positionSizeUSD,
    });
    return result as CarryScreenResult;
  }

  async gasEstimate(params: {
    chains?: string[];
    operations?: string[];
  }): Promise<GasEstimateResult> {
    const result = await this.callTool('gas.estimate', {
      chains: params.chains ?? ['ethereum'],
      operations: params.operations,
    });
    return result as GasEstimateResult;
  }

  async walletBalances(params: {
    address: string;
    chains?: string[];
  }): Promise<WalletBalancesResult> {
    const result = await this.callTool('wallet.balances', {
      address: params.address,
      chains: params.chains,
    });
    return result as WalletBalancesResult;
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.close();
      this.connected = false;
    }
  }
}
