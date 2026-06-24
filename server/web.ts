import express from 'express';
import { createServer, request as httpRequest } from 'http';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT ?? 5052);
const DATA_SERVER_URL = process.env.DATA_SERVER_URL ?? 'http://mavericdata.isi.edu:5051';

const app = express();

// Proxy all /api/* requests to the data server
app.use('/api', (req, res) => {
  const target = new URL(DATA_SERVER_URL);
  const options = {
    hostname: target.hostname,
    port: Number(target.port) || 80,
    path: `/api${req.url}`,
    method: req.method,
    headers: { ...req.headers, host: target.host },
  };
  const proxyReq = httpRequest(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });
  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'Data server unavailable' });
  });
  req.pipe(proxyReq, { end: true });
});

// Serve built frontend
const distDir = resolve(__dirname, '..', 'dist');
app.use(express.static(distDir));

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(resolve(distDir, 'index.html'));
});

createServer(app).listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
  console.log(`Proxying /api to ${DATA_SERVER_URL}`);
});
