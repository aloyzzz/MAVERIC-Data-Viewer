import express from 'express';
import cors from 'cors';
import { router } from './routes.js';
import { initDb } from './db.js';

const PORT = Number(process.env.PORT ?? 5051);

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', router);

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`GSS API server running on port ${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
