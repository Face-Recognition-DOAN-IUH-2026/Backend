import { z } from 'zod';
import { AppDataSource } from '../data-source';
import { AiInsight } from '../entities/AiInsight';
import { AiRun } from '../entities/AiRun';
import { config } from '../config';
import { HttpError } from '../middlewares/errorHandler';
import { OpenRouterClient } from '../clients/OpenRouterClient';
import { DataCollector } from './DataCollector';
import { AiInsightDto, CommandCenterSummary, LibraryOperationsSnapshot } from './types';

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
