import { v4 as uuidv4 } from 'uuid';

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
      id: uuidv4(),
      messages: [],
      patronId,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): ChatSession | undefined {
    return this.sessions.get(id);
  }

  update(id: string, updates: Partial<ChatSession>): ChatSession | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;

    const updated = { ...session, ...updates };
    this.sessions.set(id, updated);
    return updated;
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

  hasPendingConfirmation(id: string): boolean {
    const session = this.sessions.get(id);
    return !!session?.pendingConfirmation;
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }
}

export const sessionStore = new SessionStore();
export default sessionStore;