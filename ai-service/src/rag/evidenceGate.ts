import { foldVietnamese, tokenizeVietnamese } from '../clients/embedding';
import type { RetrievedDocument } from './retriever';

export type EvidenceVerdict = 'SUFFICIENT' | 'INSUFFICIENT_CONFIDENCE' | 'OUT_OF_SCOPE' | 'INSUFFICIENT_COMPLETENESS';

export interface EvidenceGateResult {
  passed: boolean;
  verdict: EvidenceVerdict;
  topScore: number;
  coverage: number;
  reason: string;
  abstainMessage?: string;
}

export interface CitationValidationResult {
  text: string;
  validCitations: string[];
  removedInvalidCitations: string[];
}

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.24;
export const GRAY_ZONE_UPPER_THRESHOLD = 0.42;

const GREETING_PATTERNS = [
  /^(xin\s+)?chao(\s+ban|\s+ad|\s+bot|\s+tvtl)?[!?.]*$/i,
  /^(hi|hello|hey)[!?.]*$/i,
  /^(cam\s+on|thank\s+you|thanks|ok|oke|tot\s+qua|tam\s+biet)[!?.]*$/i,
  /^ban\s+la\s+ai[?!.]*$/i,
  /^ban\s+lam\s+duoc\s+gi[?!.]*$/i,
];

const TOOL_INTENT_KEYWORDS = [
  'tim sach',
  'tra cuu sach',
  'co sach',
  'muon sach nao',
  'dang muon',
  'lich su muon',
  'thong tin the',
  'han the',
  'no phat',
  'tien phat cua toi',
  'gio mo cua',
  'may gio mo',
  'may gio dong',
  'lich truc',
  'ca truc',
  'nhan vien truc',
  'thong ke',
  'bao cao',
  'book_card',
  'isbn',
];

const LIBRARY_DOMAIN_KEYWORDS = [
  'thu vien',
  'sach',
  'muon',
  'tra',
  'gia han',
  'the thu vien',
  'phat',
  'qua han',
  'noi quy',
  'quy dinh',
  'chinh sach',
  'gio mo cua',
  'tang',
  'phong doc',
  'kiosk',
  'face id',
  'khuon mat',
  'vietqr',
  'tai lieu',
  'giao trinh',
  'luan van',
  'tap chi',
  'nhan vien',
  'thu thu',
  'doc gia',
  'iuh',
];

export function isConversationalOrToolIntent(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;

  const folded = foldVietnamese(trimmed).toLowerCase();
  if (GREETING_PATTERNS.some((re) => re.test(folded))) {
    return true;
  }

  return TOOL_INTENT_KEYWORDS.some((kw) => folded.includes(kw));
}

export function isLibraryDomainQuery(query: string): boolean {
  const folded = foldVietnamese(query).toLowerCase();
  return LIBRARY_DOMAIN_KEYWORDS.some((kw) => folded.includes(kw));
}

function computeLexicalCoverage(query: string, docs: RetrievedDocument[]): number {
  const tokens = tokenizeVietnamese(query, true);
  const queryTokens = tokens.length > 0 ? tokens : tokenizeVietnamese(query, false);
  if (queryTokens.length === 0) return 1;

  const combinedText = docs.map((d) => `${d.docTitle} ${d.content}`).join(' ');
  const docTokenSet = new Set(tokenizeVietnamese(combinedText, false).map(foldVietnamese));

  let hits = 0;
  for (const qt of queryTokens) {
    if (docTokenSet.has(foldVietnamese(qt))) {
      hits += 1;
    }
  }
  return hits / queryTokens.length;
}

export function buildAbstainMessage(verdict: EvidenceVerdict): string {
  switch (verdict) {
    case 'OUT_OF_SCOPE':
      return 'Xin lỗi, câu hỏi này nằm ngoài phạm vi tri thức và nghiệp vụ của Thư viện IUH. Mình chỉ hỗ trợ tra cứu sách, nội quy, giờ mở cửa, thẻ thư viện và các dịch vụ thư viện IUH.';
    case 'INSUFFICIENT_COMPLETENESS':
    case 'INSUFFICIENT_CONFIDENCE':
    default:
      return 'Hiện tại mình chưa tìm thấy đủ thông tin đáng tin cậy trong các tài liệu chính thức của Thư viện IUH để trả lời chính xác câu hỏi này. Bạn có thể diễn đạt cụ thể hơn hoặc liên hệ trực tiếp quầy Thủ thư để được hỗ trợ chính xác nhất.';
  }
}

/**
 * Evaluates whether retrieved context provides sufficient, in-scope evidence
 * before allowing the LLM to generate a Knowledge Base answer.
 */
export function evaluateEvidence(
  query: string,
  docs: RetrievedDocument[],
  confidenceThreshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
): EvidenceGateResult {
  if (isConversationalOrToolIntent(query)) {
    return {
      passed: true,
      verdict: 'SUFFICIENT',
      topScore: docs[0]?.score ?? 1,
      coverage: 1,
      reason: 'Bypassed for conversational or tool-calling intent',
    };
  }

  const inScope = isLibraryDomainQuery(query);
  const topScore = docs.length > 0
    ? (docs[0].score ?? Math.max(0, 1 - (docs[0].distance ?? 1)))
    : 0;
  const coverage = docs.length > 0 ? computeLexicalCoverage(query, docs) : 0;

  if (docs.length === 0 || topScore < confidenceThreshold) {
    const verdict: EvidenceVerdict = inScope ? 'INSUFFICIENT_CONFIDENCE' : 'OUT_OF_SCOPE';
    return {
      passed: false,
      verdict,
      topScore,
      coverage,
      reason: `Top retrieval score (${topScore.toFixed(3)}) below threshold (${confidenceThreshold})`,
      abstainMessage: buildAbstainMessage(verdict),
    };
  }

  if (!inScope && topScore < GRAY_ZONE_UPPER_THRESHOLD) {
    return {
      passed: false,
      verdict: 'OUT_OF_SCOPE',
      topScore,
      coverage,
      reason: 'Query appears outside library domain with low retrieval confidence',
      abstainMessage: buildAbstainMessage('OUT_OF_SCOPE'),
    };
  }

  if (topScore < GRAY_ZONE_UPPER_THRESHOLD && coverage < 0.35) {
    return {
      passed: false,
      verdict: 'INSUFFICIENT_COMPLETENESS',
      topScore,
      coverage,
      reason: `Gray-zone score (${topScore.toFixed(3)}) with low lexical coverage (${coverage.toFixed(2)})`,
      abstainMessage: buildAbstainMessage('INSUFFICIENT_COMPLETENESS'),
    };
  }

  return {
    passed: true,
    verdict: 'SUFFICIENT',
    topScore,
    coverage,
    reason: 'Evidence gate passed',
  };
}

/**
 * Post-checks `[Document Title]` citations in the LLM response against actual retrieved docs.
 * Removes hallucinated citations that do not match any retrieved docTitle or source.
 */
export function validateCitations(
  responseText: string,
  docs: RetrievedDocument[],
): CitationValidationResult {
  if (!responseText || docs.length === 0) {
    return { text: responseText, validCitations: [], removedInvalidCitations: [] };
  }

  const validNormalized = docs.map((d) => ({
    title: foldVietnamese(d.docTitle || '').toLowerCase(),
    source: foldVietnamese(d.source || '').toLowerCase(),
  }));

  const validCitations: string[] = [];
  const removedInvalidCitations: string[] = [];

  const cleaned = responseText.replace(/\[([^\[\]\n]{3,80})\]/g, (fullMatch, inner: string) => {
    const trimmed = inner.trim();
    if (/^(voice|he thong|\d+)$/i.test(foldVietnamese(trimmed))) {
      return fullMatch;
    }

    const normCite = foldVietnamese(trimmed).toLowerCase();
    const isMatched = validNormalized.some(
      (v) =>
        (v.title && (v.title.includes(normCite) || normCite.includes(v.title))) ||
        (v.source && (v.source.includes(normCite) || normCite.includes(v.source))),
    );

    if (isMatched) {
      validCitations.push(trimmed);
      return fullMatch;
    }

    removedInvalidCitations.push(trimmed);
    return '';
  });

  return {
    text: cleaned.replace(/\s{2,}/g, ' ').replace(/\s+([.,!?;:])/g, '$1').trim(),
    validCitations,
    removedInvalidCitations,
  };
}
