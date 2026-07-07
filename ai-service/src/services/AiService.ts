import { z } from 'zod';
import { AppDataSource } from '../data-source';
import { AiInsight } from '../entities/AiInsight';
import { AiRun } from '../entities/AiRun';
import { config } from '../config';
import { HttpError } from '../../../shared/error-handler';
import { OpenRouterClient } from '../clients/OpenRouterClient';
import { DataCollector } from './DataCollector';
import { AiInsightDto, BookRecommendation, BookRecommendationResponse, CommandCenterSummary, InsightExplanation, LibraryOperationsSnapshot } from './types';
import { getServiceToken } from '../../../shared/auth';

const insightRepo = () => AppDataSource.getRepository(AiInsight);
const runRepo = () => AppDataSource.getRepository(AiRun);

const chatSchema = z.object({ question: z.string().min(1).max(1000) });

function dto(entity: AiInsight): AiInsightDto {
  return {
    id: entity.id,
    category: entity.category as any,
    severity: entity.severity as any,
    title: entity.title,
    summary: entity.summary,
    evidence: entity.evidence || [],
    recommended_actions: entity.recommendedActions || [],
    reason: entity.reason || '',
    confidence: entity.confidence ?? 0.85,
    alternatives: entity.alternatives || [],
    status: entity.status as any,
    generated_at: entity.generatedAt.toISOString(),
  };
}

function compactSnapshot(snapshot: LibraryOperationsSnapshot) {
  return {
    active_patrons: snapshot.active_patrons,
    today_entries: snapshot.today_entries,
    today_exits: snapshot.today_exits,
    active_borrows: snapshot.active_borrows,
    overdue_borrows: snapshot.overdue_borrows,
    scheduled_staff_today: snapshot.scheduled_staff_today,
  };
}

export class AiService {
  private collector = new DataCollector();
  private openRouter = new OpenRouterClient();

  async getSummary(token: string, force = false): Promise<CommandCenterSummary> {
    if (!force) {
      const cached = await this.getCachedSummary();
      if (cached) return cached;
    }
    try {
      return await this.generateSummary(token);
    } catch (error) {
      const cached = await this.getCachedSummary(true);
      if (cached) return cached;
      throw error;
    }
  }

  async listInsights(filters: { status?: string; category?: string; severity?: string }) {
    const where: any = {};
    if (filters.status) where.status = filters.status;
    if (filters.category) where.category = filters.category;
    if (filters.severity) where.severity = filters.severity;
    const items = await insightRepo().find({
      where,
      order: { generatedAt: 'DESC' },
      take: 100,
    });
    return { items: items.map(dto), total: items.length };
  }

  async dismissInsight(id: string) {
    const insight = await insightRepo().findOneBy({ id });
    if (!insight) throw new HttpError(404, 'Insight not found');
    insight.status = 'dismissed';
    return dto(await insightRepo().save(insight));
  }

  async recommendBooks(token: string, studentCode: string): Promise<BookRecommendationResponse> {
    const [historyRes, booksRes] = await Promise.all([
      this.fetchInternal(`${config.borrowServiceUrl}/borrow/internal/patrons/${studentCode}/history`),
      this.fetchWithAuth(`${config.borrowServiceUrl}/borrow/books?skip=0&limit=200`, token),
    ]);

    const patronHistory = Array.isArray(historyRes) ? historyRes : [];
    const availableBooks = Array.isArray(booksRes?.items) ? booksRes.items : (Array.isArray(booksRes) ? booksRes : []);

    const patronName = patronHistory.length > 0
      ? (patronHistory[0] as any)?.patron_name || (patronHistory[0] as any)?.patron?.name || studentCode
      : studentCode;

    const borrowedAuthorCategory = new Set<string>();
    const borrowedIsbns = new Set<string>();
    for (const record of patronHistory) {
      const r = record as any;
      if (r.book?.author) borrowedAuthorCategory.add(r.book.author.toLowerCase());
      if (r.book?.category) borrowedAuthorCategory.add(r.book.category.toLowerCase());
      if (r.isbn || r.book?.isbn) borrowedIsbns.add((r.isbn || r.book?.isbn).replace(/-/g, ''));
    }

    const recommendations: BookRecommendation[] = [];
    const scored: Array<{ book: any; score: number; reasons: string[] }> = [];

    for (const book of availableBooks) {
      const b = book as any;
      const bookIsbn = (b.isbn || '').replace(/-/g, '');
      if (borrowedIsbns.has(bookIsbn)) continue;
      if (b.available_copies != null && b.available_copies <= 0) continue;

      const bookCategory = (b.category || b.categories || '').toLowerCase();
      const reasons: string[] = [];
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

  private async fetchWithAuth(url: string, token: string): Promise<any> {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  }

  private async fetchInternal(url: string): Promise<any> {
    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${getServiceToken('ai-service', config.jwtSecret)}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  }

  async explainInsight(id: string): Promise<InsightExplanation> {
    const insight = await insightRepo().findOneBy({ id });
    if (!insight) throw new HttpError(404, 'Insight not found');

    const run = insight.runId ? await runRepo().findOneBy({ id: insight.runId }) : null;
    const reasoningTrace = run?.reasoningTrace || buildReasoningTrace(insight);

    return {
      id: insight.id,
      title: insight.title,
      category: insight.category as any,
      severity: insight.severity as any,
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

  async chat(token: string, body: unknown) {
    const { question } = chatSchema.parse(body);
    const snapshot = await this.collector.collect(token);
    const insights = (await insightRepo().find({ where: { status: 'open' }, order: { generatedAt: 'DESC' }, take: 10 })).map(dto);
    const answer = await this.openRouter.chat(question, snapshot, insights);
    return { ...answer, generated_at: new Date().toISOString() };
  }

  private async getCachedSummary(ignoreAge = false): Promise<CommandCenterSummary | null> {
    const latestRun = await runRepo().findOne({ where: { status: 'success' }, order: { createdAt: 'DESC' } });
    if (!latestRun) return null;
    if (!ignoreAge) {
      const ageMs = Date.now() - latestRun.createdAt.getTime();
      if (ageMs > config.ai.refreshMinutes * 60_000) return null;
    }
    const insights = await insightRepo().find({
      where: { runId: latestRun.id, status: 'open' },
      order: { generatedAt: 'DESC' },
    });
    const snapshot = latestRun.snapshot as any;
    return {
      generated_at: latestRun.createdAt.toISOString(),
      model: latestRun.model,
      headline: insights[0]?.title || 'AI Command Center sẵn sàng',
      operational_score: Number(snapshot.operational_score || 80),
      insights: insights.map(dto),
      snapshot: compactSnapshot(snapshot as LibraryOperationsSnapshot),
    };
  }

  private async generateSummary(token: string): Promise<CommandCenterSummary> {
    const snapshot = await this.collector.collect(token);
    const run = runRepo().create({
      model: config.ai.mockMode ? 'mock' : config.openRouter.model,
      status: 'running',
      snapshot: snapshot as unknown as Record<string, unknown>,
    } as Partial<AiRun>);
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
    } catch (error: any) {
      savedRun.status = 'error';
      savedRun.errorMessage = error?.message || 'AI analysis failed';
      await runRepo().save(savedRun);
      throw error;
    }
  }
}

export const aiService = new AiService();

function buildReasoningTrace(insight: AiInsight): string {
  const lines: string[] = [];
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
