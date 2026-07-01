"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiService = exports.AiService = void 0;
const zod_1 = require("zod");
const data_source_1 = require("../data-source");
const AiInsight_1 = require("../entities/AiInsight");
const AiRun_1 = require("../entities/AiRun");
const config_1 = require("../config");
const shared_1 = require("../../../shared");
const OpenRouterClient_1 = require("../clients/OpenRouterClient");
const DataCollector_1 = require("./DataCollector");
const shared_2 = require("../../../shared");
const insightRepo = () => data_source_1.AppDataSource.getRepository(AiInsight_1.AiInsight);
const runRepo = () => data_source_1.AppDataSource.getRepository(AiRun_1.AiRun);
const chatSchema = zod_1.z.object({ question: zod_1.z.string().min(1).max(1000) });
function dto(entity) {
    return {
        id: entity.id,
        category: entity.category,
        severity: entity.severity,
        title: entity.title,
        summary: entity.summary,
        evidence: entity.evidence || [],
        recommended_actions: entity.recommendedActions || [],
        reason: entity.reason || '',
        confidence: entity.confidence ?? 0.85,
        alternatives: entity.alternatives || [],
        status: entity.status,
        generated_at: entity.generatedAt.toISOString(),
    };
}
function compactSnapshot(snapshot) {
    return {
        active_patrons: snapshot.active_patrons,
        today_entries: snapshot.today_entries,
        today_exits: snapshot.today_exits,
        active_borrows: snapshot.active_borrows,
        overdue_borrows: snapshot.overdue_borrows,
        scheduled_staff_today: snapshot.scheduled_staff_today,
    };
}
class AiService {
    collector = new DataCollector_1.DataCollector();
    openRouter = new OpenRouterClient_1.OpenRouterClient();
    async getSummary(token, force = false) {
        if (!force) {
            const cached = await this.getCachedSummary();
            if (cached)
                return cached;
        }
        try {
            return await this.generateSummary(token);
        }
        catch (error) {
            const cached = await this.getCachedSummary(true);
            if (cached)
                return cached;
            throw error;
        }
    }
    async listInsights(filters) {
        const where = {};
        if (filters.status)
            where.status = filters.status;
        if (filters.category)
            where.category = filters.category;
        if (filters.severity)
            where.severity = filters.severity;
        const items = await insightRepo().find({
            where,
            order: { generatedAt: 'DESC' },
            take: 100,
        });
        return { items: items.map(dto), total: items.length };
    }
    async dismissInsight(id) {
        const insight = await insightRepo().findOneBy({ id });
        if (!insight)
            throw new shared_1.HttpError(404, 'Insight not found');
        insight.status = 'dismissed';
        return dto(await insightRepo().save(insight));
    }
    async recommendBooks(token, studentCode) {
        const [historyRes, booksRes] = await Promise.all([
            this.fetchInternal(`${config_1.config.borrowServiceUrl}/borrow/internal/patrons/${studentCode}/history`),
            this.fetchWithAuth(`${config_1.config.borrowServiceUrl}/borrow/books?skip=0&limit=200`, token),
        ]);
        const patronHistory = Array.isArray(historyRes) ? historyRes : [];
        const availableBooks = Array.isArray(booksRes?.items) ? booksRes.items : (Array.isArray(booksRes) ? booksRes : []);
        const patronName = patronHistory.length > 0
            ? patronHistory[0]?.patron_name || patronHistory[0]?.patron?.name || studentCode
            : studentCode;
        const borrowedAuthorCategory = new Set();
        const borrowedIsbns = new Set();
        for (const record of patronHistory) {
            const r = record;
            if (r.book?.author)
                borrowedAuthorCategory.add(r.book.author.toLowerCase());
            if (r.book?.category)
                borrowedAuthorCategory.add(r.book.category.toLowerCase());
            if (r.isbn || r.book?.isbn)
                borrowedIsbns.add((r.isbn || r.book?.isbn).replace(/-/g, ''));
        }
        const recommendations = [];
        const scored = [];
        for (const book of availableBooks) {
            const b = book;
            const bookIsbn = (b.isbn || '').replace(/-/g, '');
            if (borrowedIsbns.has(bookIsbn))
                continue;
            if (b.available_copies != null && b.available_copies <= 0)
                continue;
            const bookCategory = (b.category || b.categories || '').toLowerCase();
            const reasons = [];
            let score = 0;
            if (b.author && borrowedAuthorCategory.has(b.author.toLowerCase())) {
                score += 30;
                reasons.push(`Độc giả đã từng mượn sách của tác giả "${b.author}"`);
            }
            if (bookCategory && borrowedAuthorCategory.has(bookCategory)) {
                score += 25;
                reasons.push(`Cùng thể loại với sách đã mượn trước đây`);
            }
            if (bookCategory && !borrowedAuthorCategory.has(bookCategory)) {
                score += 5;
            }
            if (b.total_copies && b.available_copies && b.available_copies / b.total_copies > 0.5) {
                score += 10;
                reasons.push(`Sách đang có sẵn nhiều bản sao`);
            }
            if (b.available_copies != null && b.available_copies === 1) {
                score -= 5;
            }
            if (reasons.length === 0 && score > 0) {
                reasons.push('Sách mới, phù hợp với sở thích chung');
            }
            if (score > 0 || reasons.length === 0) {
                scored.push({ book: b, score, reasons });
            }
        }
        scored.sort((a, b) => b.score - a.score);
        const topBooks = scored.slice(0, 8);
        for (const item of topBooks) {
            const b = item.book;
            recommendations.push({
                book_id: b.id || '',
                isbn: b.isbn || '',
                title: b.title || 'Không rõ tên',
                author: b.author || 'Không rõ',
                cover_url: b.cover_url || '',
                category: b.category || b.categories || '',
                reason: item.reasons.length > 0 ? item.reasons[0] : 'Sách phổ biến trong thư viện',
                relevance_score: Math.min(100, Math.max(10, item.score + (item.reasons.length * 5))),
            });
        }
        return {
            patron_id: studentCode,
            patron_name: patronName,
            recommendations,
            generated_at: new Date().toISOString(),
            model: 'recommendation-engine',
        };
    }
    async fetchWithAuth(url, token) {
        try {
            const res = await fetch(url, {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok)
                return [];
            return await res.json();
        }
        catch {
            return [];
        }
    }
    async fetchInternal(url) {
        try {
            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${(0, shared_2.getServiceToken)('ai-service', config_1.config.jwtSecret)}` },
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok)
                return [];
            return await res.json();
        }
        catch {
            return [];
        }
    }
    async explainInsight(id) {
        const insight = await insightRepo().findOneBy({ id });
        if (!insight)
            throw new shared_1.HttpError(404, 'Insight not found');
        const run = insight.runId ? await runRepo().findOneBy({ id: insight.runId }) : null;
        const reasoningTrace = run?.reasoningTrace || buildReasoningTrace(insight);
        return {
            id: insight.id,
            title: insight.title,
            category: insight.category,
            severity: insight.severity,
            summary: insight.summary,
            evidence: insight.evidence || [],
            reason: insight.reason || '',
            confidence: insight.confidence ?? 0.85,
            alternatives: insight.alternatives || [],
            recommended_actions: insight.recommendedActions || [],
            reasoning_trace: reasoningTrace,
            generated_at: insight.generatedAt.toISOString(),
        };
    }
    async chat(token, body) {
        const { question } = chatSchema.parse(body);
        const snapshot = await this.collector.collect(token);
        const insights = (await insightRepo().find({ where: { status: 'open' }, order: { generatedAt: 'DESC' }, take: 10 })).map(dto);
        const answer = await this.openRouter.chat(question, snapshot, insights);
        return { ...answer, generated_at: new Date().toISOString() };
    }
    async getCachedSummary(ignoreAge = false) {
        const latestRun = await runRepo().findOne({ where: { status: 'success' }, order: { createdAt: 'DESC' } });
        if (!latestRun)
            return null;
        if (!ignoreAge) {
            const ageMs = Date.now() - latestRun.createdAt.getTime();
            if (ageMs > config_1.config.ai.refreshMinutes * 60_000)
                return null;
        }
        const insights = await insightRepo().find({
            where: { runId: latestRun.id, status: 'open' },
            order: { generatedAt: 'DESC' },
        });
        const snapshot = latestRun.snapshot;
        return {
            generated_at: latestRun.createdAt.toISOString(),
            model: latestRun.model,
            headline: insights[0]?.title || 'AI Command Center sẵn sàng',
            operational_score: Number(snapshot.operational_score || 80),
            insights: insights.map(dto),
            snapshot: compactSnapshot(snapshot),
        };
    }
    async generateSummary(token) {
        const snapshot = await this.collector.collect(token);
        const run = runRepo().create({
            model: config_1.config.ai.mockMode ? 'mock' : config_1.config.openRouter.model,
            status: 'running',
            snapshot: snapshot,
        });
        const savedRun = await runRepo().save(run);
        try {
            const { result, usage, latencyMs } = await this.openRouter.analyze(snapshot);
            savedRun.status = 'success';
            savedRun.latencyMs = latencyMs;
            savedRun.promptTokens = usage?.prompt_tokens ?? null;
            savedRun.completionTokens = usage?.completion_tokens ?? null;
            savedRun.snapshot = { ...snapshot, operational_score: result.operational_score };
            await runRepo().save(savedRun);
            const entities = result.insights.slice(0, 8).map((item) => insightRepo().create({
                category: item.category,
                severity: item.severity,
                title: item.title,
                summary: item.summary,
                evidence: item.evidence || [],
                recommendedActions: item.recommended_actions || [],
                reason: item.reason || '',
                confidence: item.confidence ?? 0.85,
                alternatives: item.alternatives || [],
                status: 'open',
                runId: savedRun.id,
            }));
            const savedInsights = await insightRepo().save(entities);
            return {
                generated_at: savedRun.createdAt.toISOString(),
                model: savedRun.model,
                headline: result.headline,
                operational_score: result.operational_score,
                insights: savedInsights.map(dto),
                snapshot: compactSnapshot(snapshot),
            };
        }
        catch (error) {
            savedRun.status = 'error';
            savedRun.errorMessage = error?.message || 'AI analysis failed';
            await runRepo().save(savedRun);
            throw error;
        }
    }
}
exports.AiService = AiService;
exports.aiService = new AiService();
function buildReasoningTrace(insight) {
    const lines = [];
    lines.push(`=== Reasoning Trace for: ${insight.title} ===`);
    lines.push(`Category: ${insight.category}`);
    lines.push(`Severity: ${insight.severity}`);
    lines.push(`Confidence: ${(insight.confidence * 100).toFixed(0)}%`);
    lines.push('');
    lines.push('1. Data Sources Analyzed:');
    for (const ev of insight.evidence || []) {
        lines.push(`   - ${ev.label}: ${ev.value}`);
    }
    lines.push('');
    lines.push('2. Assessment:');
    lines.push(`   ${insight.reason || insight.summary}`);
    lines.push('');
    lines.push('3. Alternatives Considered:');
    for (const alt of insight.alternatives || []) {
        lines.push(`   - ${alt}`);
    }
    lines.push('');
    lines.push('4. Recommended Actions:');
    for (const action of insight.recommendedActions || []) {
        lines.push(`   - ${action}`);
    }
    return lines.join('\n');
}
