import { randomUUID } from 'crypto';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface PendingConfirmation {
  action: string;
  toolName: string;
  toolArgs: Record<string, any>;
  description: string;
}

export interface ChatSession {
  id: string;
  messages: ChatMessage[];
  patronId?: string;
  pendingConfirmation?: PendingConfirmation;
}

class SessionStore {
  private sessions = new Map<string, ChatSession>();

  create(patronId?: string): ChatSession {
    const session: ChatSession = {
      id: randomUUID(),
      messages: [],
      patronId,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): ChatSession | undefined {
    return this.sessions.get(id);
  }

  getOwned(id: string, patronId: string): ChatSession | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (session.patronId && session.patronId !== patronId) return undefined;
    return session;
  }

  addMessage(id: string, message: ChatMessage): ChatSession | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;

    session.messages.push(message);
    return session;
  }

  setConfirmation(id: string, confirmation: PendingConfirmation | undefined): ChatSession | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;

    session.pendingConfirmation = confirmation;
    return session;
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }
}

export const sessionStore = new SessionStore();
export default sessionStore;