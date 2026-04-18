import { Agent, unstable_callable as callable } from "agents";

export interface MeetingAgentState {
  queueLength: number;
  lastMeetingId: string | null;
  lastProcessedAt: string | null;
}

export class MeetingAgent extends Agent<any, MeetingAgentState> {
  initialState: MeetingAgentState = {
    queueLength: 0,
    lastMeetingId: null,
    lastProcessedAt: null
  };

  @callable()
  async enqueueMeeting(payload: { meetingId: string }) {
    this.setState({
      queueLength: this.state.queueLength + 1,
      lastMeetingId: payload.meetingId,
      lastProcessedAt: new Date().toISOString()
    });

    return {
      ok: true,
      queueLength: this.state.queueLength,
      lastMeetingId: this.state.lastMeetingId
    };
  }

  @callable()
  getSnapshot() {
    return this.state;
  }
}
