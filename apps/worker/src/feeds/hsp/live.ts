/** Live HSP client. FEED-SCHEMA-PLACEHOLDER: endpoints, request/response shapes and auth not yet confirmed. */
import type { HspClient, HspServiceDetail, HspServiceSummary } from '@mct/shared';

export class LiveHspClient implements HspClient {
  readonly mode = 'live' as const;
  async serviceMetrics(): Promise<HspServiceSummary[]> {
    throw new Error('Live HSP client not implemented: set HSP_MODE=mock until the docs are supplied');
  }
  async serviceDetails(): Promise<HspServiceDetail> {
    throw new Error('Live HSP client not implemented: set HSP_MODE=mock until the docs are supplied');
  }
}
