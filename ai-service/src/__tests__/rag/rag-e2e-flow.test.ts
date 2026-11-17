import zlib from 'zlib';

jest.mock('../../config', () => ({
  config: {
    port: 3004,
    nodeEnv: 'test',
    jwtSecret: 'test-jwt-secret',
    jwtIssuer: 'test-issuer',
    jwtAudience: 'test-audience',
    serviceJwtSecret: 'test-service-jwt',
    openRouter: { apiKey: '', model: 'openai/gpt-4.1-mini', baseUrl: 'https://openrouter.ai/api/v1' },
    llm: { baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: '', model: 'meta/llama-3.1-70b-instruct' },
    nvidiaApiKey: '',
    nvidiaModel: 'meta/llama-3.1-70b-instruct',
    nvidiaEmbedModel: 'nvidia/nv-embedqa-e5-v5',
    chromaDbUrl: 'http://localhost:8000',
    chromaCollection: 'library-kb',
    ai: { refreshMinutes: 15, mockMode: true },
    db: { host: 'localhost', port: 5432, database: 'aidb', schema: 'ai', user: 'test', password: 'test' },
    corsOrigins: [],
    tts: { provider: 'mock', apiKey: '' },
    asr: { provider: 'mock', apiKey: '' },
  },
}));

// In-memory 384-dim ChromaDB collection store backed by real hashEmbeddingFn
interface StoredEntry {
  id: string;
  document: string;
  metadata: Record<string, string>;
  embedding: number[];
}

const roleStores = new Map<string, StoredEntry[]>();

function l2DistanceSq(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum;
}

jest.mock('../../clients/chromadb', () => {
  const { textToEmbedding } = require('../../clients/embedding');

  const getStore = (role: string): StoredEntry[] => {
    const key = role || 'patron';
    if (!roleStores.has(key)) roleStores.set(key, []);
    return roleStores.get(key)!;
  };

  return {
    getCollection: jest.fn(async (role: string) => {
      const store = getStore(role);
      return {
        add: async (payload: { ids: string[]; documents: string[]; metadatas: Record<string, string>[]; embeddings?: number[][] }) => {
          for (let i = 0; i < payload.ids.length; i++) {
            const vec = payload.embeddings?.[i] ?? textToEmbedding(payload.documents[i]);
            expect(vec).toHaveLength(384);
            store.push({
              id: payload.ids[i],
              document: payload.documents[i],
              metadata: payload.metadatas[i] || {},
              embedding: vec,
            });
          }
        },
        get: async (opts?: { where?: Record<string, any> }) => {
          let entries = store;
          if (opts?.where?.source) {
            const targetSource = typeof opts.where.source === 'string'
              ? opts.where.source
              : opts.where.source.$eq;
            entries = store.filter(e => e.metadata.source === targetSource);
          }
          return {
            ids: entries.map(e => e.id),
            documents: entries.map(e => e.document),
            metadatas: entries.map(e => e.metadata),
          };
        },
        delete: async (opts: { ids: string[] }) => {
          const idSet = new Set(opts.ids);
          const remaining = store.filter(e => !idSet.has(e.id));
          store.length = 0;
          store.push(...remaining);
        },
        query: async (opts: { queryTexts: string[]; nResults?: number }) => {
          const qVec = textToEmbedding(opts.queryTexts[0] || '');
          const scored = store
            .map(entry => ({
              entry,
              dist: l2DistanceSq(qVec, entry.embedding),
            }))
            .sort((a, b) => a.dist - b.dist)
            .slice(0, opts.nResults ?? 5);

          return {
            ids: [scored.map(s => s.entry.id)],
            documents: [scored.map(s => s.entry.document)],
            metadatas: [scored.map(s => s.entry.metadata)],
            distances: [scored.map(s => s.dist)],
          };
        },
      };
    }),
    resetCollection: jest.fn(async (role: string) => {
      roleStores.set(role || 'patron', []);
      return {};
    }),
  };
});

const mockCreateChatCompletion = jest.fn();
jest.mock('../../clients/nvidia', () => ({
  nvidiaClient: {
    createChatCompletion: (...args: any[]) => mockCreateChatCompletion(...args),
    streamChatCompletion: jest.fn(),
  },
}));

import { chunkText } from '../../rag/embedder';
import { indexDocuments } from '../../rag/indexer';
import { ragService } from '../../services/RagService';
import { retrieve } from '../../rag/retriever';
import { processMessage } from '../../agent/agent';

/** Build a valid minimal .docx (ZIP containing word/document.xml) buffer. */
function buildMinimalDocxBuffer(paragraphs: string[]): Buffer {
  const xmlBody = paragraphs
    .map(p => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
    .join('');
  const xmlContent = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${xmlBody}</w:body></w:document>`;

  const fileNameBuf = Buffer.from('word/document.xml', 'utf-8');
  const uncompressedBuf = Buffer.from(xmlContent, 'utf-8');
  const compressedBuf = zlib.deflateRawSync(uncompressedBuf);

  // Local File Header (30 bytes + fileName)
  const localHeader = Buffer.alloc(30 + fileNameBuf.length);
  localHeader.writeUInt32LE(0x04034b50, 0); // signature
  localHeader.writeUInt16LE(20, 4); // version needed
  localHeader.writeUInt16LE(0, 6); // flags
  localHeader.writeUInt16LE(8, 8); // deflate
  localHeader.writeUInt16LE(0, 10); // mod time
  localHeader.writeUInt16LE(0, 12); // mod date
  localHeader.writeUInt32LE(0, 14); // crc32 (unused by inflate)
  localHeader.writeUInt32LE(compressedBuf.length, 18);
  localHeader.writeUInt32LE(uncompressedBuf.length, 22);
  localHeader.writeUInt16LE(fileNameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28); // extra len
  fileNameBuf.copy(localHeader, 30);

  const cdOffset = localHeader.length + compressedBuf.length;

  // Central Directory Header (46 bytes + fileName)
  const cdHeader = Buffer.alloc(46 + fileNameBuf.length);
  cdHeader.writeUInt32LE(0x02014b50, 0); // signature
  cdHeader.writeUInt16LE(20, 4);
  cdHeader.writeUInt16LE(20, 6);
  cdHeader.writeUInt16LE(0, 8);
  cdHeader.writeUInt16LE(8, 10); // deflate
  cdHeader.writeUInt32LE(compressedBuf.length, 20);
  cdHeader.writeUInt32LE(uncompressedBuf.length, 24);
  cdHeader.writeUInt16LE(fileNameBuf.length, 28);
  cdHeader.writeUInt16LE(0, 30);
  cdHeader.writeUInt16LE(0, 32);
  cdHeader.writeUInt32LE(0, 42); // localHeaderOffset
  fileNameBuf.copy(cdHeader, 46);

  // End of Central Directory (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdHeader.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localHeader, compressedBuf, cdHeader, eocd]);
}

describe('Knowledge Base RAG End-to-End Flow', () => {
  const createdSources: string[] = [];

  beforeEach(() => {
    roleStores.clear();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    for (const src of createdSources) {
      await ragService.deleteDocument(src).catch(() => {});
    }
  });

  describe('chunkText()', () => {
    it('preserves trailing sentences and bullet items without ending punctuation', () => {
      const text = [
        'Quy định mới thư viện IUH.',
        '- Mượn tối đa 8 cuốn trong 21 ngày',
        '- Phí quá hạn mới là 5000 đồng mỗi ngày',
        'Áp dụng từ học kỳ 1 năm 2026',
      ].join('\n');

      const chunks = chunkText(text, 200);
      const joined = chunks.join('\n');

      expect(chunks.length).toBeGreaterThan(0);
      expect(joined).toContain('Mượn tối đa 8 cuốn trong 21 ngày');
      expect(joined).toContain('Phí quá hạn mới là 5000 đồng mỗi ngày');
      expect(joined).toContain('Áp dụng từ học kỳ 1 năm 2026');
    });

    it('splits long punctuation-free paragraphs without dropping characters', () => {
      const words = Array.from({ length: 120 }, (_, i) => `tu_${i}`);
      const longText = words.join(' ');
      const chunks = chunkText(longText, 150);

      expect(chunks.length).toBeGreaterThan(2);
      expect(chunks.join(' ')).toContain('tu_0');
      expect(chunks.join(' ')).toContain('tu_119');
    });
  });

  describe('RagService.extractText()', () => {
    it('extracts plain UTF-8 text from .txt and .md files', async () => {
      const content = 'Hướng dẫn sử dụng phòng tự học yên tĩnh tầng C';
      const extracted = await ragService.extractText({
        originalname: 'huong_dan.md',
        buffer: Buffer.from(content, 'utf-8'),
        mimetype: 'text/markdown',
      });
      expect(extracted).toBe(content);
    });

    it('extracts clean Vietnamese XML text from real ZIP .docx buffer', async () => {
      const docxBuffer = buildMinimalDocxBuffer([
        'QUY ĐỊNH PHÒNG THỰC TẾ ẢO VR',
        'Sinh viên được sử dụng tối đa 45 phút mỗi lượt.',
      ]);
      const extracted = await ragService.extractText({
        originalname: 'vr_policy.docx',
        buffer: docxBuffer,
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      expect(extracted).toContain('QUY ĐỊNH PHÒNG THỰC TẾ ẢO VR');
      expect(extracted).toContain('Sinh viên được sử dụng tối đa 45 phút mỗi lượt.');
    });

    it('rejects binary garbage and corrupt/unreadable PDF files instead of indexing binary', async () => {
      const corruptPdf = Buffer.from('%PDF-1.4\n\x00\x01\x02binary-corrupt', 'latin1');
      await expect(
        ragService.extractText({
          originalname: 'broken.pdf',
          buffer: corruptPdf,
          mimetype: 'application/pdf',
        }),
      ).rejects.toThrow();

      const oleDoc = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0x00, 0x01, 0x02, 0x03]);
      await expect(
        ragService.extractText({
          originalname: 'legacy.doc',
          buffer: oleDoc,
          mimetype: 'application/msword',
        }),
      ).rejects.toThrow();
    });
  });

  describe('Upload -> Hybrid Retrieve -> Agent System Prompt', () => {
    it('retrieves newly uploaded public document first and injects it into Agent prompt', async () => {
      // Seed baseline static docs first
      const { textToEmbedding } = require('../../clients/embedding');
      for (const role of ['patron', 'staff', 'admin']) {
        const list = roleStores.get(role) || [];
        const baselineText = '[Giờ Mở Cửa] Thư viện mở cửa Thứ Hai đến Thứ Sáu từ 06:30 đến 21:00.';
        list.push({
          id: `static_${role}_1`,
          document: baselineText,
          metadata: { source: 'gio-mo-cua.md', doc_title: 'Giờ Mở Cửa', roles: 'patron, staff, admin' },
          embedding: textToEmbedding(baselineText),
        });
        roleStores.set(role, list);
      }

      const publicSource = 'Quy_dinh_phong_VR_2026.txt';
      createdSources.push(publicSource);
      const docContent = 'Mỗi sinh viên được đăng ký sử dụng phòng thực tế ảo VR tối đa 45 phút/lượt và đặt trước qua cổng thư viện ít nhất 2 giờ';

      const summary = await ragService.uploadDocument(
        {
          originalname: publicSource,
          buffer: Buffer.from(docContent, 'utf-8'),
          mimetype: 'text/plain',
          size: Buffer.byteLength(docContent, 'utf-8'),
        },
        'public',
      );
      expect(summary.chunksCount).toBe(1);
      expect(summary.audience).toBe('public');

      // Query using Vietnamese question -> should retrieve uploaded doc as top result
      const retrieved = await retrieve('Sinh viên được dùng phòng thực tế ảo VR tối đa bao nhiêu phút?', 5, 'patron');
      expect(retrieved.length).toBeGreaterThan(0);
      expect(retrieved[0].source).toBe(publicSource);
      expect(retrieved[0].content).toContain('45 phút/lượt');

      // Verify processMessage injects this retrieved doc into the system prompt sent to the LLM
      mockCreateChatCompletion.mockResolvedValue('Mỗi sinh viên được dùng phòng thực tế ảo VR tối đa 45 phút/lượt [Quy_dinh_phong_VR_2026].');
      const reply = await processMessage(
        'Sinh viên được dùng phòng thực tế ảo VR tối đa bao nhiêu phút?',
        'sess-vr-1',
        'patron',
      );

      expect(reply.response).toContain('45 phút/lượt');
      expect(mockCreateChatCompletion).toHaveBeenCalledTimes(1);
      const sentMessages = mockCreateChatCompletion.mock.calls[0][0];
      expect(sentMessages[0].role).toBe('system');
      expect(sentMessages[0].content).toContain('Knowledge Base Context');
      expect(sentMessages[0].content).toContain('tối đa 45 phút/lượt');
    });

    it('isolates staff_only uploaded documents from patron queries while returning them for staff/admin', async () => {
      const staffSource = 'Quy_trinh_kiem_ke_noi_bo_2026.txt';
      createdSources.push(staffSource);
      const staffContent = 'Quy trình kiểm kê mã vạch nội bộ tầng C thực hiện vào 17h30 thứ Sáu hàng tuần bởi tổ thủ thư trực ca.';

      await ragService.uploadDocument(
        {
          originalname: staffSource,
          buffer: Buffer.from(staffContent, 'utf-8'),
          mimetype: 'text/plain',
          size: Buffer.byteLength(staffContent, 'utf-8'),
        },
        'staff_only',
      );

      const patronDocs = await retrieve('Quy trình kiểm kê mã vạch nội bộ tầng C lúc mấy giờ?', 5, 'patron');
      expect(patronDocs.some(d => d.source === staffSource)).toBe(false);

      const staffDocs = await retrieve('Quy trình kiểm kê mã vạch nội bộ tầng C lúc mấy giờ?', 5, 'staff');
      expect(staffDocs.length).toBeGreaterThan(0);
      expect(staffDocs[0].source).toBe(staffSource);
      expect(staffDocs[0].content).toContain('17h30 thứ Sáu hàng tuần');
    });

    it('preserves uploaded documents and indexes handbook when indexDocuments() runs on startup', async () => {
      const customSource = 'Thong_bao_hoc_ky_he_2026.txt';
      createdSources.push(customSource);
      const customText = 'Thư viện phục vụ xuyên suốt học kỳ hè đến 20h00 từ Thứ Hai đến Thứ Bảy';

      await ragService.uploadDocument(
        {
          originalname: customSource,
          buffer: Buffer.from(customText, 'utf-8'),
          mimetype: 'text/plain',
          size: Buffer.byteLength(customText, 'utf-8'),
        },
        'public',
      );

      // Simulate restart where startup indexer resets collections and re-indexes docs
      await indexDocuments();

      // Verify uploaded document survived resetCollection()
      const customResults = await retrieve('Học kỳ hè thư viện phục vụ đến mấy giờ?', 5, 'patron');
      expect(customResults.some(d => d.source === customSource && d.content.includes('20h00'))).toBe(true);

      // Verify comprehensive handbook .md was indexed (no longer skipped due to missing frontmatter)
      const adminDocs = await ragService.listDocuments();
      expect(adminDocs.some(d => d.source === 'tai-lieu-tong-hop-thu-vien-iuh.md')).toBe(true);
    });
  });
});
