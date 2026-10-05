import { Agent, unstable_callable as callable } from "agents";

export interface OnboardingAgentState {
  activeTraineeCount: number;
  lastEventType: string | null;
  lastProcessedAt: string | null;
}

export class OnboardingAgent extends Agent<any, OnboardingAgentState> {
  initialState: OnboardingAgentState = {
    activeTraineeCount: 0,
    lastEventType: null,
    lastProcessedAt: null
  };

  @callable()
  async recordEvent(payload: { eventType: string; traineeDelta?: number }) {
    this.setState({
      activeTraineeCount: Math.max(
        0,
        this.state.activeTraineeCount + (payload.traineeDelta ?? 0)
      ),
      lastEventType: payload.eventType,
      lastProcessedAt: new Date().toISOString()
    });

    return {
      ok: true,
      activeTraineeCount: this.state.activeTraineeCount,
      lastEventType: this.state.lastEventType
    };
  }

  @callable()
  getSnapshot() {
    return this.state;
  }
}
