import { Agent, unstable_callable as callable } from "agents";

export interface InfraAgentState {
  pendingAlertCount: number;
  lastAssetId: string | null;
  lastProcessedAt: string | null;
}

export class InfraAgent extends Agent<any, InfraAgentState> {
  initialState: InfraAgentState = {
    pendingAlertCount: 0,
    lastAssetId: null,
    lastProcessedAt: null
  };

  @callable()
  async recordAssetEvent(payload: { assetId: string; needsAlert: boolean }) {
    this.setState({
      pendingAlertCount: this.state.pendingAlertCount + (payload.needsAlert ? 1 : 0),
      lastAssetId: payload.assetId,
      lastProcessedAt: new Date().toISOString()
    });

    return {
      ok: true,
      pendingAlertCount: this.state.pendingAlertCount,
      lastAssetId: this.state.lastAssetId
    };
  }

  @callable()
  getSnapshot() {
    return this.state;
  }
}
