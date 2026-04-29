import type { Logger } from 'pino';
import { errMsg } from '../util/format.ts';

export interface WebhookPayload {
  event: 'dump.success' | 'dump.failure';
  tool: 'dumpvault';
  db: string;
  engine: string;
  timestamp: string;
  duration_ms?: number;
  bytes?: number;
  sha256?: string;
  output_path?: string;
  error?: string;
  /** Plain-text summary for Slack/Teams/Discord-compatible consumers. */
  text: string;
}

const TIMEOUT_MS = 10_000;

export async function postWebhook(
  url: string,
  payload: WebhookPayload,
  log: Logger,
): Promise<void> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      log.warn({ url, status: res.status }, 'webhook returned non-2xx');
    } else {
      log.debug({ url, event: payload.event }, 'webhook delivered');
    }
  } catch (err) {
    log.warn({ url, err: errMsg(err) }, 'webhook delivery failed');
  }
}
