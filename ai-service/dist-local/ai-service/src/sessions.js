"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionStore = void 0;
const uuid_1 = require("uuid");
class SessionStore {
    sessions = new Map();
    create(patronId) {
        const session = {
            id: (0, uuid_1.v4)(),
            messages: [],
            patronId,
        };
        this.sessions.set(session.id, session);
        return session;
    }
    get(id) {
        return this.sessions.get(id);
    }
    getOwned(id, patronId) {
        const session = this.sessions.get(id);
        if (!session)
            return undefined;
        if (session.patronId && session.patronId !== patronId)
            return undefined;
        return session;
    }
    findByPatronId(patronId) {
        for (const session of this.sessions.values()) {
            if (session.patronId === patronId)
                return session;
        }
        return undefined;
    }
    update(id, updates) {
        const session = this.sessions.get(id);
        if (!session)
            return undefined;
        const updated = { ...session, ...updates };
        this.sessions.set(id, updated);
        return updated;
    }
    addMessage(id, message) {
        const session = this.sessions.get(id);
        if (!session)
            return undefined;
        session.messages.push(message);
        return session;
    }
    setConfirmation(id, confirmation) {
        const session = this.sessions.get(id);
        if (!session)
            return undefined;
        session.pendingConfirmation = confirmation;
        return session;
    }
    hasPendingConfirmation(id) {
        const session = this.sessions.get(id);
        return !!session?.pendingConfirmation;
    }
    delete(id) {
        return this.sessions.delete(id);
    }
}
exports.sessionStore = new SessionStore();
exports.default = exports.sessionStore;
