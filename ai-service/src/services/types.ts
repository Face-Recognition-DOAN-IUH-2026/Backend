export type InsightCategory = 'access' | 'borrow' | 'schedule' | 'inventory' | 'risk';
export type InsightSeverity = 'info' | 'warning' | 'critical';
export type InsightStatus = 'open' | 'dismissed' | 'resolved';

export interface AiInsightDto {
  id: string;
  category: InsightCategory;
  severity: InsightSeverity;
  title: string;
  summary: string;
  evidence: Array<{ label: string; value: string | number }>;
  recommended_actions: string[];
  reason: string;
  confidence: number;
  alternatives: string[];
  status: InsightStatus;
  generated_at: string;
}

export interface InsightExplanation {
  id: string;
  title: string;
  category: InsightCategory;
  severity: InsightSeverity;
  summary: string;
  evidence: Array<{ label: string; value: string | number }>;
  reason: string;
  confidence: number;
  alternatives: string[];
  recommended_actions: string[];
  reasoning_trace: string;
  generated_at: string;
}

export interface LibraryOperationsSnapshot {
  active_patrons: number;
  today_entries: number;
  today_exits: number;
  active_borrows: number;
  overdue_borrows: number;
  scheduled_staff_today: number;
  access_logs_sample: any[];
  active_borrowers_sample: any[];
  schedule_assignments_sample: any[];
  inventory_sample: any[];
  warnings: string[];
}

export interface CommandCenterSummary {
  generated_at: string;
  model: string;
  headline: string;
  operational_score: number;
  insights: AiInsightDto[];
  snapshot: {
    active_patrons: number;
    today_entries: number;
    today_exits: number;
    active_borrows: number;
    overdue_borrows: number;
    scheduled_staff_today: number;
  };
}

export interface AiAnalysisResult {
  headline: string;
  operational_score: number;
  insights: Array<Omit<AiInsightDto, 'id' | 'status' | 'generated_at'>>;
}

export interface BookRecommendation {
  book_id: string;
  isbn: string;
  title: string;
  author: string;
  cover_url: string;
  category: string;
  reason: string;
  relevance_score: number;
}

export interface BookRecommendationResponse {
  patron_id: string;
  patron_name: string;
  recommendations: BookRecommendation[];
  generated_at: string;
  model: string;
}
