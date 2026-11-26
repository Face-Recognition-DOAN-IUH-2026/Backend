import {
  evaluateEvidence,
  isConversationalOrToolIntent,
  validateCitations,
} from '../../rag/evidenceGate';
import type { RetrievedDocument } from '../../rag/retriever';

const sampleDocs: RetrievedDocument[] = [
  {
    id: 'doc-1',
    docTitle: 'Quy định mượn trả sách IUH',
    source: 'quy-dinh-muon-tra.md',
    content: 'Sinh viên được mượn tối đa 5 cuốn sách trong thời hạn 14 ngày và có thể gia hạn 1 lần 7 ngày.',
    score: 0.72,
    authority: 'official',
  },
  {
    id: 'doc-2',
    docTitle: 'Chính sách phạt quá hạn',
    source: 'chinh-sach-phat.md',
    content: 'Mức phạt quá hạn là 2.000 VNĐ/ngày/cuốn sách kể từ ngày hết hạn.',
    score: 0.65,
    authority: 'official',
  },
];

describe('EvidenceGate & CitationValidator', () => {
  it('bypasses gate for greetings and tool-calling intents', () => {
    expect(isConversationalOrToolIntent('Xin chào bạn')).toBe(true);
    expect(isConversationalOrToolIntent('Tìm sách Clean Code giúp tôi')).toBe(true);
    expect(isConversationalOrToolIntent('Tôi đang mượn những sách nào?')).toBe(true);

    const res = evaluateEvidence('Tìm sách Clean Code giúp tôi', []);
    expect(res.passed).toBe(true);
    expect(res.verdict).toBe('SUFFICIENT');
  });

  it('passes when evidence has high confidence and matches library domain', () => {
    const res = evaluateEvidence('Sinh viên được mượn tối đa bao nhiêu cuốn sách?', sampleDocs);
    expect(res.passed).toBe(true);
    expect(res.verdict).toBe('SUFFICIENT');
  });

  it('abstains when query is out of library scope with low retrieval score', () => {
    const weakDocs: RetrievedDocument[] = [
      {
        id: 'weak-1',
        docTitle: 'Giới thiệu thư viện',
        source: 'gioi-thieu.md',
        content: 'Thư viện IUH phục vụ sinh viên.',
        score: 0.16,
        authority: 'general',
      },
    ];
    const res = evaluateEvidence('Cách nấu phở bò Hà Nội ngon nhất?', weakDocs);
    expect(res.passed).toBe(false);
    expect(res.verdict).toBe('OUT_OF_SCOPE');
    expect(res.abstainMessage).toContain('ngoài phạm vi');
  });

  it('abstains when in-domain query lacks sufficient evidence in gray zone', () => {
    const grayDocs: RetrievedDocument[] = [
      {
        id: 'gray-1',
        docTitle: 'Nội quy chung',
        source: 'noi-quy-thu-vien.md',
        content: 'Độc giả cần giữ trật tự khi vào phòng đọc.',
        score: 0.30,
        authority: 'official',
      },
    ];
    const res = evaluateEvidence('Thư viện có hỗ trợ in 3D miễn phí cho khóa luận không?', grayDocs);
    expect(res.passed).toBe(false);
    expect(res.verdict).toBe('INSUFFICIENT_COMPLETENESS');
    expect(res.abstainMessage).toContain('chưa tìm thấy đủ thông tin');
  });

  it('validates citations and strips hallucinated document titles', () => {
    const llmReply =
      'Sinh viên được mượn tối đa 5 cuốn [Quy định mượn trả sách IUH] và không mất phí [Tài liệu bịa đặt 2099]. Tham khảo thêm [1].';
    const validated = validateCitations(llmReply, sampleDocs);

    expect(validated.validCitations).toEqual(['Quy định mượn trả sách IUH']);
    expect(validated.removedInvalidCitations).toEqual(['Tài liệu bịa đặt 2099']);
    expect(validated.text).toContain('[Quy định mượn trả sách IUH]');
    expect(validated.text).toContain('[1]');
    expect(validated.text).not.toContain('[Tài liệu bịa đặt 2099]');
  });
});
