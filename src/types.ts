// ---------------------------------------------------------------------------
// Policy — user-configured, no defaults, no advice
// ---------------------------------------------------------------------------

export interface PolicyConfig {
  maxLTV: number;
  healthFactorFloor: number;
  emergencyHealthFactor: number;
  maxPositionUSD: number;
  minProfitOverGasMultiple: number;
  deleveragePercent: number;
  allowedProtocols: string[];
  monitorIntervalMinutes: number;
}

export interface ProviderConfig {
  type: 'syenite' | 'custom';
  url: string;
  apiKey?: string;
}

export interface NotificationsConfig {
  webhookUrl?: string;
  onWarning: boolean;
  onCritical: boolean;
  onEmergency: boolean;
  onRejection: boolean;
}

export interface ApiConfig {
  port: number;
  auth?: string;
}

export interface BasaltConfig {
  provider: ProviderConfig;
  wallet?: { privateKey: string };
  database?: { url: string };
  policy: PolicyConfig;
  notifications?: NotificationsConfig;
  api?: ApiConfig;
}

// ---------------------------------------------------------------------------
// Raw transaction — the universal input to the policy gate
// ---------------------------------------------------------------------------

export interface RawTransaction {
  to: string;
  data: string;
  value: string;
  chainId: number;
  from?: string;
}

// ---------------------------------------------------------------------------
// Validation results
// ---------------------------------------------------------------------------

export type CheckStatus = 'pass' | 'fail' | 'skip';

export interface CheckResult {
  rule: string;
  status: CheckStatus;
  detail: string;
}

export interface ValidationResult {
  approved: boolean;
  checks: CheckResult[];
  rejectionReason?: string;
}

// ---------------------------------------------------------------------------
// Strategy proposals
// ---------------------------------------------------------------------------

export interface StrategyProposal {
  type: 'carry' | 'yield' | 'custom';
  collateral: string;
  collateralAmount: number;
  borrowAsset?: string;
  targetLTV?: number;
  deployTo?: string;
  protocol?: string;
}

export interface CarryParams {
  collateral: string;
  collateralAmount: number;
  borrowAsset: string;
  targetLTV: number;
  deployTo: string;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface TransactionStep {
  action: string;
  tx: RawTransaction;
  policyCheck?: ValidationResult;
  txHash?: string;
  status: 'pending' | 'validated' | 'submitted' | 'confirmed' | 'failed';
}

export interface ExecutionResult {
  status: 'validated' | 'rejected' | 'dry_run' | 'partial_unwind';
  steps: TransactionStep[];
  rejectionReason?: string;
  costs?: { providerCalls: number; estimatedUSDC: number };
}

// ---------------------------------------------------------------------------
// Portfolio & positions
// ---------------------------------------------------------------------------

export type PositionSide = 'collateral' | 'borrow' | 'deployment';
export type PositionStatus = 'active' | 'closed' | 'liquidated';

export interface Position {
  id?: number;
  protocol: string;
  chain: string;
  asset: string;
  amount: number;
  side: PositionSide;
  entryTime: string;
  entryRate?: number;
  status: PositionStatus;
}

export interface PortfolioSnapshot {
  id?: number;
  timestamp: string;
  totalCollateralUSD: number;
  totalBorrowedUSD: number;
  totalDeployedUSD: number;
  netValueUSD: number;
  aggregateLTV: number;
  healthFactor: number;
}

export interface Portfolio {
  collateral: Position[];
  borrows: Position[];
  deployments: Position[];
  healthFactor: number | null;
  aggregateLTV: number | null;
  netValueUSD: number | null;
}

// ---------------------------------------------------------------------------
// Activity & risk events
// ---------------------------------------------------------------------------

export type ActivitySource = 'agent' | 'risk_monitor' | 'manual' | 'api';
export type ActivityAction = 'validate' | 'execute' | 'deleverage' | 'unwind' | 'snapshot' | 'rejection';

export interface ActivityEntry {
  id?: number;
  timestamp: string;
  source: ActivitySource;
  actionType: ActivityAction;
  detail: Record<string, unknown>;
}

export type RiskSeverity = 'warning' | 'critical' | 'emergency';

export interface RiskEvent {
  id?: number;
  timestamp: string;
  severity: RiskSeverity;
  healthFactor: number;
  actionTaken: string;
  txHashes: string[];
}

export type RiskEventHandler = (event: RiskEvent) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Risk check response
// ---------------------------------------------------------------------------

export interface RiskCheckResult {
  positions: Array<{
    protocol: string;
    chain: string;
    healthFactor: number | null;
    status: 'safe' | 'warning' | 'critical' | 'unknown';
  }>;
  overallStatus: 'safe' | 'warning' | 'critical' | 'no_positions';
}

// ---------------------------------------------------------------------------
// DataProvider — pluggable interface for data + intelligence
// ---------------------------------------------------------------------------

export interface TxSimulateResult {
  success: boolean;
  gasUsed?: string;
  error?: string;
  logs?: unknown[];
}

export interface TxVerifyResult {
  verified: boolean;
  contractName?: string;
  compiler?: string;
  error?: string;
}

export interface TxGuardResult {
  passed: boolean;
  failedRules: string[];
  details: Record<string, unknown>;
}

export interface GuardRules {
  maxValueNative?: string;
  allowedContracts?: string[];
  blockedContracts?: string[];
  allowedFunctions?: string[];
  requireVerifiedContract?: boolean;
  requireAllowlisted?: boolean;
  maxGasLimit?: number;
}

export interface RiskAssessResult {
  healthFactor: number;
  liquidationPrice: number;
  currentPrice: number;
  maxBorrow: number;
  protocol: string;
  risk: string;
}

export interface CarryScreenResult {
  strategies: Array<{
    market: string;
    protocol: string;
    supplyRate: number;
    borrowRate: number;
    netCarry: number;
    healthFactor: number;
  }>;
}

export interface GasEstimateResult {
  chain: string;
  gasPrice: string;
  estimates: Record<string, { gas: number; costUSD: number }>;
}

export interface WalletBalancesResult {
  address: string;
  balances: Array<{
    chain: string;
    asset: string;
    balance: string;
    valueUSD: number;
  }>;
}

export interface PositionMonitorResult {
  positions: Array<{
    protocol: string;
    chain: string;
    healthFactor: number | null;
    totalCollateralUSD: number;
    totalBorrowedUSD: number;
    ltv: number;
  }>;
}

export interface DataProvider {
  txSimulate(tx: RawTransaction): Promise<TxSimulateResult>;
  txVerify(tx: RawTransaction): Promise<TxVerifyResult>;
  txGuard(tx: RawTransaction, rules: GuardRules): Promise<TxGuardResult>;
  riskAssess(params: {
    collateral: string;
    collateralAmount: number;
    borrowAsset?: string;
    targetLTV: number;
    protocol?: string;
  }): Promise<RiskAssessResult>;
  positionMonitor(params: {
    address: string;
    protocol?: string;
    chain?: string;
  }): Promise<PositionMonitorResult>;
  carryScreen(params: {
    collateral?: string;
    borrowAsset?: string;
    chain?: string;
    minCarry?: number;
    positionSizeUSD?: number;
  }): Promise<CarryScreenResult>;
  gasEstimate(params: {
    chains?: string[];
    operations?: string[];
  }): Promise<GasEstimateResult>;
  walletBalances(params: {
    address: string;
    chains?: string[];
  }): Promise<WalletBalancesResult>;
}
