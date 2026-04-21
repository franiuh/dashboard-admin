/**
 * src/index.js — Servidor principal
 * Dashboard Administrativo API REST
 * Autor: Francisca Villalba
 */
require('dotenv').config();

const express      = require('express');
const http         = require('http');
const cors         = require('cors');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const { Server }   = require('socket.io');

// ── Rutas ──────────────────────────────────────────────────
const authRoutes    = require('./routes/auth');
const kpisRoutes    = require('./routes/kpis');
const ventasRoutes  = require('./routes/ventas');
const ordenesRoutes = require('./routes/ordenes');
//const exportRoutes  = require('./routes/export');
const alertasRoutes = require('./routes/alertas');

// ── Socket.io setup ────────────────────────────────────────
const setupSockets  = require('./sockets');

const app    = express();
const server = http.createServer(app);

// ── Socket.io ─────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin:      process.env.CLIENT_URL || '*',
    methods:     ['GET','POST'],
    credentials: true,
  },
});
setupSockets(io);
app.set('io', io); // Acceso desde rutas

// ── Seguridad ──────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin:      process.env.CLIENT_URL || '*',
  credentials: true,
  methods:     ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

// Rate limiting — 200 req/15min por IP (general)
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      200,
  message:  { ok: false, error: 'Demasiadas solicitudes, intenta en 15 minutos' },
  standardHeaders: true,
  legacyHeaders:   false,
}));

// Rate limiting estricto en login (10 req/15min)
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      10,
  message:  { ok: false, error: 'Demasiados intentos de login' },
}));

// ── Body parsing ───────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Logger mínimo ──────────────────────────────────────────
app.use((req, _res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`${new Date().toLocaleTimeString('es-CL')} ${req.method} ${req.path}`);
  }
  next();
});

// ── Rutas API ─────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/kpis',    kpisRoutes);
app.use('/api/ventas',  ventasRoutes);
app.use('/api/ordenes', ordenesRoutes);
//app.use('/api/export',  exportRoutes);
app.use('/api/alertas', alertasRoutes);

// ── Health check ──────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    ok:        true,
    version:   '1.0.0',
    ambiente:  process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    autor:     'Francisca Villalba',
  });
});

// ── Ruta raíz ─────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    nombre:    'Dashboard API REST',
    version:   '1.0.0',
    endpoints: [
      'POST /api/auth/login',
      'POST /api/auth/refresh',
      'GET  /api/auth/me',
      'GET  /api/kpis?periodo=30&categoria=all',
      'GET  /api/ventas',
      'GET  /api/ventas/mensual?anio=2025',
      'GET  /api/ventas/prediccion',
      'GET  /api/ordenes?estado=&categoria=&page=1&limit=10',
      'GET  /api/ordenes/:id',
      'POST /api/ordenes',
      'PUT  /api/ordenes/:id',
      'GET  /api/alertas',
      'POST /api/alertas/check',
      //'GET  /api/export/excel?periodo=30&estado=&categoria=',
      //'GET  /api/export/csv',
      'GET  /api/health',
    ],
  });
});

// ── Error handler global ───────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[ERROR GLOBAL]', err);
  res.status(err.status || 500).json({
    ok:    false,
    error: process.env.NODE_ENV === 'production' ? 'Error interno del servidor' : err.message,
  });
});

// ── 404 ───────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Ruta no encontrada' });
});

// ── Iniciar servidor ──────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   Dashboard API — Francisca Villalba     ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  🚀  http://localhost:${PORT}                ║`);
  console.log(`║  🔌  Socket.io activo                    ║`);
  console.log(`║  🌍  Ambiente: ${(process.env.NODE_ENV||'development').padEnd(26)}║`);
  console.log('╚══════════════════════════════════════════╝\n');
});

// Graceful shutdown
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT',  () => { server.close(() => process.exit(0)); });
