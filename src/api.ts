import { Hono } from 'hono';
import type { Validator } from './validator.js';
import type { Orchestrator } from './orchestrator.js';
import type { RiskMonitor } from './risk-monitor.js';
import type { StateStore } from './state.js';
import type { PolicyConfig, RawTransaction, StrategyProposal, CarryParams } from './types.js';

export function createApi(deps: {
  validator: Validator;
  orchestrator: Orchestrator;
  riskMonitor: RiskMonitor;
  state: StateStore;
  policy: PolicyConfig;
  authToken?: string;
}): Hono {
  const app = new Hono();
  const { validator, orchestrator, riskMonitor, state, policy, authToken } = deps;

  // Auth middleware
  if (authToken) {
    app.use('/api/*', async (c, next) => {
      const auth = c.req.header('Authorization');
      if (!auth || auth !== `Bearer ${authToken}`) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
      await next();
    });
  }

  // ---------------------------------------------------------------------------
  // Policy gate — THE core endpoint
  // ---------------------------------------------------------------------------

  app.post('/api/validate/transaction', async (c) => {
    try {
      const body = await c.req.json<RawTransaction>();
      if (!body.to || !body.data || body.chainId === undefined) {
        return c.json({ error: 'Missing required fields: to, data, value, chainId' }, 400);
      }
      const result = await validator.validateTransaction({
        to: body.to,
        data: body.data,
        value: body.value ?? '0',
        chainId: body.chainId,
        from: body.from,
      });
      return c.json(result);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  // ---------------------------------------------------------------------------
  // Strategy validation
  // ---------------------------------------------------------------------------

  app.post('/api/validate/strategy', async (c) => {
    try {
      const body = await c.req.json<StrategyProposal>();
      if (!body.type || !body.collateral) {
        return c.json({ error: 'Missing required fields: type, collateral' }, 400);
      }
      const result = await validator.validateStrategy(body);
      return c.json(result);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  // ---------------------------------------------------------------------------
  // Orchestration (convenience)
  // ---------------------------------------------------------------------------

  app.post('/api/orchestrate/carry', async (c) => {
    try {
      const body = await c.req.json<CarryParams>();
      if (!body.collateral || !body.borrowAsset || !body.deployTo) {
        return c.json({ error: 'Missing required fields: collateral, collateralAmount, borrowAsset, targetLTV, deployTo' }, 400);
      }
      const result = await orchestrator.buildCarrySequence(body);
      return c.json(result);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post('/api/orchestrate/deleverage', async (c) => {
    try {
      const body = await c.req.json<{ percent: number; protocol?: string }>();
      if (!body.percent) {
        return c.json({ error: 'Missing required field: percent' }, 400);
      }
      const result = await orchestrator.buildDeleverageSequence(body);
      return c.json(result);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post('/api/orchestrate/unwind', async (c) => {
    try {
      const result = await orchestrator.buildUnwindSequence();
      return c.json(result);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  // ---------------------------------------------------------------------------
  // State reads
  // ---------------------------------------------------------------------------

  app.get('/api/portfolio', async (c) => {
    try {
      const portfolio = await state.getPortfolio();
      return c.json(portfolio);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.get('/api/positions', async (c) => {
    try {
      const status = c.req.query('status');
      const side = c.req.query('side');
      const positions = await state.getPositions({
        status: status || undefined,
        side: side || undefined,
      });
      return c.json({ positions });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.get('/api/risk', async (c) => {
    try {
      const result = await riskMonitor.checkRisk();
      return c.json(result);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.get('/api/activity', async (c) => {
    try {
      const limit = parseInt(c.req.query('limit') ?? '50', 10);
      const activity = await state.getActivity(limit);
      return c.json({ activity });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.get('/api/policy', async (c) => {
    return c.json({ policy });
  });

  app.get('/api/health', async (c) => {
    return c.json({
      status: 'ok',
      version: '0.1.0',
      disclaimer: 'This software provides NO financial advice. You are solely responsible for your configuration.',
    });
  });

  return app;
}
