import { Agent, unstable_callable as callable } from "agents";

export interface KnowledgeAgentState {
  pendingEmbeddingCount: number;
  lastDocumentId: string | null;
  lastProcessedAt: string | null;
}

export class KnowledgeAgent extends Agent<any, KnowledgeAgentState> {
  initialState: KnowledgeAgentState = {
    pendingEmbeddingCount: 0,
    lastDocumentId: null,
    lastProcessedAt: null
  };

  @callable()
  async enqueueDocument(payload: { documentId: string }) {
    this.setState({
      pendingEmbeddingCount: this.state.pendingEmbeddingCount + 1,
      lastDocumentId: payload.documentId,
      lastProcessedAt: new Date().toISOString()
    });

    return {
      ok: true,
      pendingEmbeddingCount: this.state.pendingEmbeddingCount,
      lastDocumentId: this.state.lastDocumentId
    };
  }

  @callable()
  getSnapshot() {
    return this.state;
  }
}
