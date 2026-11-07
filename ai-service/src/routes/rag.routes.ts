import { Router, Response } from 'express';
import multer from 'multer';
import { requireRole } from '../../../shared/auth';
import type { AuthRequest } from '../../../shared/auth/types';
import { ragService } from '../services/RagService';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 MB
  },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(pdf|txt|md|docx?)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ chấp nhận các định dạng file: PDF, TXT, MD, DOC, DOCX'));
    }
  },
});

/**
 * @swagger
 * /ai/rag/upload:
 *   post:
 *     summary: Upload document to RAG Knowledge Base (Admin only)
 *     tags: [AI RAG]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/upload',
  requireRole(['admin']),
  upload.single('file'),
  async (req: AuthRequest, res: Response) => {
    try {
      const audience = (req.body.audience === 'staff_only' ? 'staff_only' : 'public') as 'public' | 'staff_only';

      if (!req.file) {
        const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
        if (!text) {
          res.status(400).json({ error: 'Vui lòng chọn file tải lên hoặc nhập nội dung văn bản' });
          return;
        }

        const rawTitle = (typeof req.body?.title === 'string' ? req.body.title.trim() : '') || `doc_${Date.now()}`;
        const originalname = rawTitle.match(/\.(txt|md)$/i) ? rawTitle : `${rawTitle}.txt`;
        const buffer = Buffer.from(text, 'utf-8');

        const result = await ragService.uploadDocument(
          {
            originalname,
            buffer,
            mimetype: 'text/plain',
            size: buffer.length,
          },
          audience,
        );

        res.status(201).json({
          success: true,
          message: 'Nạp nội dung tri thức vào Knowledge Base thành công',
          data: result,
        });
        return;
      }

      const result = await ragService.uploadDocument(
        {
          originalname: req.file.originalname,
          buffer: req.file.buffer,
          mimetype: req.file.mimetype,
          size: req.file.size,
        },
        audience,
      );

      res.status(201).json({
        success: true,
        message: 'Tải lên và xử lý tài liệu vào Knowledge Base thành công',
        data: result,
      });
    } catch (error: any) {
      console.error('[RAG] Upload error:', error);
      res.status(500).json({ error: error.message || 'Lỗi khi xử lý tải lên tài liệu' });
    }
  },
);

/**
 * @swagger
 * /ai/rag/documents:
 *   get:
 *     summary: List documents in RAG Knowledge Base (Admin/Staff)
 *     tags: [AI RAG]
 *     security:
 *       - bearerAuth: []
 */
router.get('/documents', requireRole(['admin', 'staff']), async (_req: AuthRequest, res: Response) => {
  try {
    const docs = await ragService.listDocuments();
    res.json({ success: true, data: docs });
  } catch (error: any) {
    console.error('[RAG] List error:', error);
    res.status(500).json({ error: error.message || 'Lỗi khi lấy danh sách tài liệu' });
  }
});

/**
 * @swagger
 * /ai/rag/documents/{source}:
 *   delete:
 *     summary: Delete document from RAG Knowledge Base (Admin only)
 *     tags: [AI RAG]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/documents/:source', requireRole(['admin']), async (req: AuthRequest, res: Response) => {
  try {
    const source = req.params.source;
    if (!source) {
      res.status(400).json({ error: 'Tên tài liệu không hợp lệ' });
      return;
    }

    const result = await ragService.deleteDocument(source);
    res.json({ success: true, message: `Đã xóa tài liệu "${source}" khỏi Knowledge Base`, data: result });
  } catch (error: any) {
    console.error('[RAG] Delete error:', error);
    res.status(500).json({ error: error.message || 'Lỗi khi xóa tài liệu' });
  }
});

export default router;

