import express from 'express';
import cors from 'cors';
import { router } from './routes.js';

const PORT = 3001;

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', router);

app.listen(PORT, () => {
  console.log(`GSS API server running at http://localhost:${PORT}`);
});
