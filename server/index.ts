import express from 'express';
import cors from 'cors';
import { router } from './routes.js';
import { initDb } from './db.js';

const PORT = 3001;

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', router);

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`GSS API server running at http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
