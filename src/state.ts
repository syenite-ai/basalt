import Database from 'better-sqlite3';
import type {
  Position,
  PortfolioSnapshot,
  ActivityEntry,
  RiskEvent,
  Portfolio,
  PolicyConfig,
} from './types.js';

// ---------------------------------------------------------------------------
// Database abstraction — SQLite default, Postgres detected from URL
// ---------------------------------------------------------------------------

export interface StateStore {
  init(): Promise<void>;

  // Positions
  addPosition(pos: Omit<Position, 'id'>): Promise<number>;
  getPositions(filter?: { status?: string; side?: string }): Promise<Position[]>;
  updatePositionStatus(id: number, status: string): Promise<void>;

  // Portfolio snapshots
  addSnapshot(snap: Omit<PortfolioSnapshot, 'id'>): Promise<number>;
  getSnapshots(limit?: number): Promise<PortfolioSnapshot[]>;
  getLatestSnapshot(): Promise<PortfolioSnapshot | null>;

  // Activity log
  addActivity(entry: Omit<ActivityEntry, 'id'>): Promise<number>;
  getActivity(limit?: number): Promise<ActivityEntry[]>;

  // Risk events
  addRiskEvent(event: Omit<RiskEvent, 'id'>): Promise<number>;
  getRiskEvents(limit?: number): Promise<RiskEvent[]>;

  // Policy config
  savePolicy(policy: PolicyConfig): Promise<void>;
  getPolicy(): Promise<PolicyConfig | null>;

  // Portfolio aggregate
  getPortfolio(): Promise<Portfolio>;

  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// SQLite implementation
// ---------------------------------------------------------------------------

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    protocol TEXT NOT NULL,
    chain TEXT NOT NULL,
    asset TEXT NOT NULL,
    amount REAL NOT NULL,
    side TEXT NOT NULL CHECK(side IN ('collateral', 'borrow', 'deployment')),
    entry_time TEXT NOT NULL,
    entry_rate REAL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'closed', 'liquidated'))
  );

  CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    total_collateral_usd REAL NOT NULL,
    total_borrowed_usd REAL NOT NULL,
    total_deployed_usd REAL NOT NULL,
    net_value_usd REAL NOT NULL,
    aggregate_ltv REAL NOT NULL,
    health_factor REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    source TEXT NOT NULL,
    action_type TEXT NOT NULL,
    detail TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS risk_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('warning', 'critical', 'emergency')),
    health_factor REAL NOT NULL,
    action_taken TEXT NOT NULL,
    tx_hashes TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS policy_config (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    config TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

export class SQLiteStore implements StateStore {
  private db: Database.Database;

  constructor(dbPath: string = './basalt.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  async init(): Promise<void> {
    this.db.exec(CREATE_TABLES_SQL);
  }

  async addPosition(pos: Omit<Position, 'id'>): Promise<number> {
    const stmt = this.db.prepare(
      'INSERT INTO positions (protocol, chain, asset, amount, side, entry_time, entry_rate, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const result = stmt.run(pos.protocol, pos.chain, pos.asset, pos.amount, pos.side, pos.entryTime, pos.entryRate ?? null, pos.status);
    return result.lastInsertRowid as number;
  }

  async getPositions(filter?: { status?: string; side?: string }): Promise<Position[]> {
    let sql = 'SELECT * FROM positions WHERE 1=1';
    const params: unknown[] = [];
    if (filter?.status) { sql += ' AND status = ?'; params.push(filter.status); }
    if (filter?.side) { sql += ' AND side = ?'; params.push(filter.side); }
    sql += ' ORDER BY id DESC';

    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map(rowToPosition);
  }

  async updatePositionStatus(id: number, status: string): Promise<void> {
    this.db.prepare('UPDATE positions SET status = ? WHERE id = ?').run(status, id);
  }

  async addSnapshot(snap: Omit<PortfolioSnapshot, 'id'>): Promise<number> {
    const stmt = this.db.prepare(
      'INSERT INTO portfolio_snapshots (timestamp, total_collateral_usd, total_borrowed_usd, total_deployed_usd, net_value_usd, aggregate_ltv, health_factor) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    const result = stmt.run(snap.timestamp, snap.totalCollateralUSD, snap.totalBorrowedUSD, snap.totalDeployedUSD, snap.netValueUSD, snap.aggregateLTV, snap.healthFactor);
    return result.lastInsertRowid as number;
  }

  async getSnapshots(limit = 100): Promise<PortfolioSnapshot[]> {
    const rows = this.db.prepare('SELECT * FROM portfolio_snapshots ORDER BY id DESC LIMIT ?').all(limit) as Array<Record<string, unknown>>;
    return rows.map(rowToSnapshot);
  }

  async getLatestSnapshot(): Promise<PortfolioSnapshot | null> {
    const row = this.db.prepare('SELECT * FROM portfolio_snapshots ORDER BY id DESC LIMIT 1').get() as Record<string, unknown> | undefined;
    return row ? rowToSnapshot(row) : null;
  }

  async addActivity(entry: Omit<ActivityEntry, 'id'>): Promise<number> {
    const stmt = this.db.prepare('INSERT INTO activity_log (timestamp, source, action_type, detail) VALUES (?, ?, ?, ?)');
    const result = stmt.run(entry.timestamp, entry.source, entry.actionType, JSON.stringify(entry.detail));
    return result.lastInsertRowid as number;
  }

  async getActivity(limit = 100): Promise<ActivityEntry[]> {
    const rows = this.db.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT ?').all(limit) as Array<Record<string, unknown>>;
    return rows.map(rowToActivity);
  }

  async addRiskEvent(event: Omit<RiskEvent, 'id'>): Promise<number> {
    const stmt = this.db.prepare('INSERT INTO risk_events (timestamp, severity, health_factor, action_taken, tx_hashes) VALUES (?, ?, ?, ?, ?)');
    const result = stmt.run(event.timestamp, event.severity, event.healthFactor, event.actionTaken, JSON.stringify(event.txHashes));
    return result.lastInsertRowid as number;
  }

  async getRiskEvents(limit = 100): Promise<RiskEvent[]> {
    const rows = this.db.prepare('SELECT * FROM risk_events ORDER BY id DESC LIMIT ?').all(limit) as Array<Record<string, unknown>>;
    return rows.map(rowToRiskEvent);
  }

  async savePolicy(policy: PolicyConfig): Promise<void> {
    this.db.prepare(
      'INSERT OR REPLACE INTO policy_config (id, config, updated_at) VALUES (1, ?, ?)',
    ).run(JSON.stringify(policy), new Date().toISOString());
  }

  async getPolicy(): Promise<PolicyConfig | null> {
    const row = this.db.prepare('SELECT config FROM policy_config WHERE id = 1').get() as { config: string } | undefined;
    return row ? JSON.parse(row.config) as PolicyConfig : null;
  }

  async getPortfolio(): Promise<Portfolio> {
    const positions = await this.getPositions({ status: 'active' });
    const collateral = positions.filter((p) => p.side === 'collateral');
    const borrows = positions.filter((p) => p.side === 'borrow');
    const deployments = positions.filter((p) => p.side === 'deployment');

    const latest = await this.getLatestSnapshot();

    return {
      collateral,
      borrows,
      deployments,
      healthFactor: latest?.healthFactor ?? null,
      aggregateLTV: latest?.aggregateLTV ?? null,
      netValueUSD: latest?.netValueUSD ?? null,
    };
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToPosition(row: Record<string, unknown>): Position {
  return {
    id: row.id as number,
    protocol: row.protocol as string,
    chain: row.chain as string,
    asset: row.asset as string,
    amount: row.amount as number,
    side: row.side as Position['side'],
    entryTime: row.entry_time as string,
    entryRate: row.entry_rate as number | undefined,
    status: row.status as Position['status'],
  };
}

function rowToSnapshot(row: Record<string, unknown>): PortfolioSnapshot {
  return {
    id: row.id as number,
    timestamp: row.timestamp as string,
    totalCollateralUSD: row.total_collateral_usd as number,
    totalBorrowedUSD: row.total_borrowed_usd as number,
    totalDeployedUSD: row.total_deployed_usd as number,
    netValueUSD: row.net_value_usd as number,
    aggregateLTV: row.aggregate_ltv as number,
    healthFactor: row.health_factor as number,
  };
}

function rowToActivity(row: Record<string, unknown>): ActivityEntry {
  return {
    id: row.id as number,
    timestamp: row.timestamp as string,
    source: row.source as ActivityEntry['source'],
    actionType: row.action_type as ActivityEntry['actionType'],
    detail: JSON.parse(row.detail as string) as Record<string, unknown>,
  };
}

function rowToRiskEvent(row: Record<string, unknown>): RiskEvent {
  return {
    id: row.id as number,
    timestamp: row.timestamp as string,
    severity: row.severity as RiskEvent['severity'],
    healthFactor: row.health_factor as number,
    actionTaken: row.action_taken as string,
    txHashes: JSON.parse(row.tx_hashes as string) as string[],
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createStore(databaseUrl?: string): StateStore {
  if (databaseUrl && databaseUrl.startsWith('postgresql://')) {
    // Postgres support is Phase 2 — for now, fall back to SQLite with a warning
    console.warn('Postgres support is not yet implemented. Falling back to SQLite.');
    return new SQLiteStore();
  }
  return new SQLiteStore(databaseUrl || './basalt.db');
}
