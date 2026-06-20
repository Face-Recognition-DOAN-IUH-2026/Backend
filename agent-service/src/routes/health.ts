import { Router, Request, Response } from 'express';
import { getCollection } from '../clients/chromadb';
import config from '../config';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  let chromadbStatus = 'disconnected';

  try {
    const collection = await getCollection();
    await collection.count();
    chromadbStatus = 'connected';
  } catch (error) {
    chromadbStatus = `error: ${error instanceof Error ? error.message : 'unknown'}`;
  }

  res.json({
    status: 'ok',
    model: config.openrouterApiKey ? (config.nvidiaModel || 'openai/gpt-oss-20b:free') : config.nvidiaModel,
    provider: config.openrouterApiKey ? 'openrouter' : 'nvidia-nim',
    chromadb: chromadbStatus,
    timestamp: new Date().toISOString(),
  });
});

export default router;