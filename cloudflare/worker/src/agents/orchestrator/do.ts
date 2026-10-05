import { Agent, unstable_callable as callable } from "agents";

export interface OrchestratorAgentState {
  routedEventCount: number;
  lastRoute: string | null;
  lastRoutedAt: string | null;
}

export class OrchestratorAgent extends Agent<any, OrchestratorAgentState> {
  initialState: OrchestratorAgentState = {
    routedEventCount: 0,
    lastRoute: null,
    lastRoutedAt: null
  };

  @callable()
  async recordRoute(payload: { route: string }) {
    this.setState({
      routedEventCount: this.state.routedEventCount + 1,
      lastRoute: payload.route,
      lastRoutedAt: new Date().toISOString()
    });

    return {
      ok: true,
      routedEventCount: this.state.routedEventCount,
      lastRoute: this.state.lastRoute
    };
  }

  @callable()
  getSnapshot() {
    return this.state;
  }
}
