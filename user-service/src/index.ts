import express from 'express';
import cors from 'cors';
import { config } from './config';
import { initDb } from './db';
import userRoutes from './routes/user.routes';

const app = express();

app.use(cors({
  origin: config.corsOrigins,
  credentials: true,
}));

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'user-service' });
});

app.use('/users', userRoutes);

async function start() {
  try {
    await initDb();
    console.log('Database initialized');

    app.listen(config.port, () => {
      console.log(`User service running on port ${config.port}`);
      console.log(`Environment: ${config.nodeEnv}`);
    });
  } catch (error) {
    console.error('Failed to start:', error);
    process.exit(1);
  }
}

start();