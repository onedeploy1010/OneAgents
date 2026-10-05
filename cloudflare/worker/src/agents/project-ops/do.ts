import { Agent, unstable_callable as callable } from "agents";

export interface ProjectOpsAgentState {
  recentEventCount: number;
  lastEvent: string | null;
  lastProcessedAt: string | null;
}

export class ProjectOpsAgent extends Agent<any, ProjectOpsAgentState> {
  initialState: ProjectOpsAgentState = {
    recentEventCount: 0,
    lastEvent: null,
    lastProcessedAt: null
  };

  @callable()
  async recordEvent(payload: { event: string }) {
    this.setState({
      recentEventCount: this.state.recentEventCount + 1,
      lastEvent: payload.event,
      lastProcessedAt: new Date().toISOString()
    });

    return {
      ok: true,
      recentEventCount: this.state.recentEventCount,
      lastEvent: this.state.lastEvent
    };
  }

  @callable()
  getSnapshot() {
    return this.state;
  }
}
