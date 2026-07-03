"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WaitlistRepository = void 0;
const data_source_1 = require("../data-source");
const Waitlist_1 = require("../entities/Waitlist");
const Book_1 = require("../entities/Book");
class WaitlistRepository {
    constructor() {
        this.repo = () => data_source_1.AppDataSource.getRepository(Waitlist_1.Waitlist);
        this.bookRepo = () => data_source_1.AppDataSource.getRepository(Book_1.Book);
    }
    async joinWaitlist(bookId, patronId) {
        const book = await this.bookRepo().findOne({ where: { id: bookId } });
        if (!book)
            throw Object.assign(new Error('Book not found'), { statusCode: 404 });
        const existing = await this.repo().findOne({ where: { bookId, patronId, status: 'waiting' } });
        if (existing)
            throw Object.assign(new Error('Already on waitlist for this book'), { statusCode: 409 });
        const entry = this.repo().create({ bookId, patronId, status: 'waiting' });
        return this.repo().save(entry);
    }
    async getWaitlistByBook(bookId) {
        return this.repo().find({
            where: { bookId, status: 'waiting' },
            order: { createdAt: 'ASC' },
        });
    }
    async markNotified(ids) {
        if (ids.length === 0)
            return;
        await this.repo()
            .createQueryBuilder()
            .update(Waitlist_1.Waitlist)
            .set({ status: 'notified', notifiedAt: new Date() })
            .whereInIds(ids)
            .execute();
    }
    async cancelWaitlist(id, patronId) {
        const entry = await this.repo().findOne({ where: { id } });
        if (!entry)
            throw Object.assign(new Error('Waitlist entry not found'), { statusCode: 404 });
        if (entry.patronId !== patronId)
            throw Object.assign(new Error('Not your waitlist entry'), { statusCode: 403 });
        await this.repo().remove(entry);
    }
    async getWaitlistById(id) {
        return this.repo().findOne({ where: { id } });
    }
}
exports.WaitlistRepository = WaitlistRepository;
