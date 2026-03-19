import type { NotificationsConfig, RiskEvent } from './types.js';

export type NotificationEventType = 'warning' | 'critical' | 'emergency' | 'execution' | 'rejection';

export interface NotificationPayload {
  type: NotificationEventType;
  timestamp: string;
  message: string;
  data?: Record<string, unknown>;
}

export class Notifier {
  constructor(private config?: NotificationsConfig) {}

  async send(payload: NotificationPayload): Promise<boolean> {
    if (!this.config?.webhookUrl) return false;

    if (!this.shouldSend(payload.type)) return false;

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.warn(`[basalt:notify] Webhook failed (${response.status}), retrying once...`);
        return this.retry(payload);
      }

      return true;
    } catch (err) {
      console.warn(`[basalt:notify] Webhook error: ${(err as Error).message}, retrying once...`);
      return this.retry(payload);
    }
  }

  async sendRiskEvent(event: RiskEvent): Promise<boolean> {
    return this.send({
      type: event.severity,
      timestamp: event.timestamp,
      message: `[${event.severity.toUpperCase()}] Health factor ${event.healthFactor.toFixed(2)} — ${event.actionTaken}`,
      data: {
        healthFactor: event.healthFactor,
        actionTaken: event.actionTaken,
        txHashes: event.txHashes,
      },
    });
  }

  async sendRejection(reason: string, detail?: Record<string, unknown>): Promise<boolean> {
    return this.send({
      type: 'rejection',
      timestamp: new Date().toISOString(),
      message: `[REJECTED] ${reason}`,
      data: detail,
    });
  }

  private shouldSend(type: NotificationEventType): boolean {
    if (!this.config) return false;
    switch (type) {
      case 'warning': return this.config.onWarning;
      case 'critical': return this.config.onCritical;
      case 'emergency': return this.config.onEmergency;
      case 'rejection': return this.config.onRejection;
      case 'execution': return true;
      default: return true;
    }
  }

  private async retry(payload: NotificationPayload): Promise<boolean> {
    if (!this.config?.webhookUrl) return false;
    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        console.error(`[basalt:notify] Retry failed (${response.status}). Giving up.`);
        return false;
      }
      return true;
    } catch (err) {
      console.error(`[basalt:notify] Retry error: ${(err as Error).message}. Giving up.`);
      return false;
    }
  }
}
