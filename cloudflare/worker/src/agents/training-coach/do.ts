import { Agent, unstable_callable as callable } from "agents";

export interface TrainingCoachState {
  reviewsToday: number;
  encouragementsSentToday: number;
  lastReviewedProgram: string | null;
  lastReviewedAt: string | null;
}

/**
 * TrainingCoachAgent — 培训规划 + 进度监管。
 * 真实工作大多在 skills/ 里完成(纯函数);这个 DO 只留状态快照。
 */
export class TrainingCoachAgent extends Agent<any, TrainingCoachState> {
  initialState: TrainingCoachState = {
    reviewsToday: 0,
    encouragementsSentToday: 0,
    lastReviewedProgram: null,
    lastReviewedAt: null
  };

  @callable()
  async recordReview(payload: { programId: string }) {
    this.setState({
      ...this.state,
      reviewsToday: this.state.reviewsToday + 1,
      lastReviewedProgram: payload.programId,
      lastReviewedAt: new Date().toISOString()
    });
    return { ok: true };
  }

  @callable()
  async recordEncouragement() {
    this.setState({
      ...this.state,
      encouragementsSentToday: this.state.encouragementsSentToday + 1
    });
    return { ok: true };
  }

  @callable()
  getSnapshot() {
    return this.state;
  }
}
