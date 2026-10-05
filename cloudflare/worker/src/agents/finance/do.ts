import { Agent, unstable_callable as callable } from "agents";

export interface FinanceAgentState {
  pendingReviewCount: number;
  lastLedgerId: string | null;
  lastProcessedAt: string | null;
}

export class FinanceAgent extends Agent<any, FinanceAgentState> {
  initialState: FinanceAgentState = {
    pendingReviewCount: 0,
    lastLedgerId: null,
    lastProcessedAt: null
  };

  @callable()
  async enqueueLedger(payload: { ledgerId: string; needsReview: boolean }) {
    this.setState({
      pendingReviewCount: this.state.pendingReviewCount + (payload.needsReview ? 1 : 0),
      lastLedgerId: payload.ledgerId,
      lastProcessedAt: new Date().toISOString()
    });

    return {
      ok: true,
      pendingReviewCount: this.state.pendingReviewCount,
      lastLedgerId: this.state.lastLedgerId
    };
  }

  @callable()
  getSnapshot() {
    return this.state;
  }
}
