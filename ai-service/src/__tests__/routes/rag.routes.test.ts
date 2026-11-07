import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createAuth } from '../../../../shared/auth';
import ragRouter from '../../routes/rag.routes';
import { ragService } from '../../services/RagService';

const JWT_SECRET = 'test-jwt-secret';

function signToken(sub: string, role: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub,
      roles: [role],
      role,
      iss: 'test-issuer',
      aud: 'test-audience',
      typ: 'access',
      iat: now,
      exp: now + 3600,
    },
    JWT_SECRET
  );
}

jest.mock('../../services/RagService', () => ({
  ragService: {
    uploadDocument: jest.fn(),
    listDocuments: jest.fn(),
    deleteDocument: jest.fn(),
  },
}));

describe('RAG Routes - Knowledge Base Management', () => {
  let app: express.Express;

  beforeAll(() => {
    const auth = createAuth({
      jwtSecret: JWT_SECRET,
      jwtAudience: 'test-audience',
      jwtIssuer: 'test-issuer',
    });
    app = express();
    app.use(express.json());
    app.use('/ai/rag', auth, ragRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /ai/rag/upload', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app).post('/ai/rag/upload');
      expect(res.status).toBe(401);
    });

    it('rejects patron role with 403 (admin only)', async () => {
      const res = await request(app)
        .post('/ai/rag/upload')
        .set('Authorization', `Bearer ${signToken('patron-1', 'patron')}`);
      expect(res.status).toBe(403);
    });

    it('rejects staff role with 403 (admin only)', async () => {
      const res = await request(app)
        .post('/ai/rag/upload')
        .set('Authorization', `Bearer ${signToken('staff-1', 'staff')}`);
      expect(res.status).toBe(403);
    });

    it('allows admin to upload document with audience', async () => {
      (ragService.uploadDocument as jest.Mock).mockResolvedValue({
        source: 'test-doc.txt',
        docTitle: 'test-doc',
        audience: 'public',
        chunksCount: 3,
        uploadedAt: new Date().toISOString(),
      });

      const res = await request(app)
        .post('/ai/rag/upload')
        .set('Authorization', `Bearer ${signToken('admin-1', 'admin')}`)
        .field('audience', 'public')
        .attach('file', Buffer.from('Noi dung huong dan thu vien IUH'), 'test-doc.txt');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(ragService.uploadDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          originalname: 'test-doc.txt',
        }),
        'public',
      );
    });
  });

  describe('GET /ai/rag/documents', () => {
    it('allows staff and admin to list documents', async () => {
      const mockDocs = [
        { source: 'doc1.pdf', docTitle: 'Noi quy', audience: 'public', chunksCount: 5 },
        { source: 'doc2.pdf', docTitle: 'Noi bo', audience: 'staff_only', chunksCount: 3 },
      ];
      (ragService.listDocuments as jest.Mock).mockResolvedValue(mockDocs);

      const res = await request(app)
        .get('/ai/rag/documents')
        .set('Authorization', `Bearer ${signToken('staff-1', 'staff')}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
    });

    it('rejects patron from listing documents with 403', async () => {
      const res = await request(app)
        .get('/ai/rag/documents')
        .set('Authorization', `Bearer ${signToken('patron-1', 'patron')}`);
      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /ai/rag/documents/:source', () => {
    it('allows admin to delete document', async () => {
      (ragService.deleteDocument as jest.Mock).mockResolvedValue({ deleted: true, source: 'doc1.pdf' });

      const res = await request(app)
        .delete('/ai/rag/documents/doc1.pdf')
        .set('Authorization', `Bearer ${signToken('admin-1', 'admin')}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(ragService.deleteDocument).toHaveBeenCalledWith('doc1.pdf');
    });

    it('rejects staff from deleting document with 403', async () => {
      const res = await request(app)
        .delete('/ai/rag/documents/doc1.pdf')
        .set('Authorization', `Bearer ${signToken('staff-1', 'staff')}`);
      expect(res.status).toBe(403);
    });
  });
});

