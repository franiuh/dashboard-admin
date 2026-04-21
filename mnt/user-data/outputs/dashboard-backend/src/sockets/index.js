/**
 * sockets/index.js — Eventos Socket.io en tiempo real
 *
 * Eventos emitidos por el servidor:
 *   nueva_orden        → nueva orden creada
 *   orden_actualizada  → estado de orden cambiado
 *   nuevas_alertas     → alertas generadas por el motor
 *   kpi_update         → KPIs recalculados (simulado cada 30s)
 *   orden_simulada     → orden generada automáticamente (demo)
 *
 * Eventos escuchados del cliente:
 *   suscribir_alertas  → cliente quiere alertas en tiempo real
 */
const jwt  = require('jsonwebtoken');
const pool = require('../config/db');

// Simulador de órdenes en tiempo real (para demo)
const CLIENTES_DEMO = [
  'María González','Carlos Ruiz','Ana Morales','Luis Vega','Sofía Castro',
  'Pedro Díaz','Valentina López','Andrés Torres','Camila Reyes','Matías Soto',
];
const PRODUCTOS_DEMO = [
  { nombre:'Smart TV 55"', cat:'Electrónica', total:349990 },
  { nombre:'Audífonos BT Pro', cat:'Electrónica', total:79990 },
  { nombre:'Zapatillas Running', cat:'Deporte', total:119990 },
  { nombre:'Chaqueta Invierno', cat:'Ropa', total:89990 },
  { nombre:'Cafetera Espresso', cat:'Hogar', total:149990 },
];
const ESTADOS_DEMO = ['Completado','Completado','Completado','Pendiente','En proceso'];
const CANALES_DEMO = ['Online','Marketplace','Local','App'];

let ordenCounter = 9000;

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

module.exports = function setupSockets(io) {

  // Middleware de autenticación para sockets
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
      // Permitir conexión sin auth pero con acceso limitado
      socket.user = null;
      return next();
    }
    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      socket.user = null;
      next(); // Seguimos, pero sin usuario
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user?.id || 'anónimo';
    console.log(`🔌 Socket conectado: ${socket.id} (usuario: ${userId})`);

    // Enviar estado inicial
    socket.emit('connected', {
      mensaje: 'Conexión en tiempo real establecida',
      usuario: socket.user?.nombre || 'Invitado',
      timestamp: new Date().toISOString(),
    });

    // Unir a sala según rol
    if (socket.user?.rol === 'admin') {
      socket.join('admins');
    }
    socket.join('dashboard');

    // Cliente pide alertas
    socket.on('suscribir_alertas', async () => {
      try {
        const [alertas] = await pool.execute(`
          SELECT * FROM alertas WHERE leida = 0
          ORDER BY creado_en DESC LIMIT 10
        `);
        socket.emit('alertas_iniciales', alertas);
      } catch {}
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Socket desconectado: ${socket.id}`);
    });
  });

  // ── Simulador de órdenes en tiempo real (cada 15-45 seg) ──
  function simularOrden() {
    const prod   = rand(PRODUCTOS_DEMO);
    const estado = rand(ESTADOS_DEMO);
    ordenCounter++;

    const orden = {
      id:         ordenCounter,
      codigo:     `ORD-${ordenCounter}`,
      cliente:    rand(CLIENTES_DEMO),
      categoria:  prod.cat,
      producto:   prod.nombre,
      total:      prod.total * randInt(1,2),
      estado,
      canal:      rand(CANALES_DEMO),
      creado_en:  new Date().toLocaleString('es-CL'),
      simulado:   true,
    };

    // Guardar en DB
    pool.execute(
      `INSERT INTO ordenes (codigo, cliente_id, categoria_id, total, estado, canal)
       SELECT ?, cl.id, cat.id, ?, ?, ?
       FROM clientes cl, categorias cat
       WHERE cl.nombre LIKE ? AND cat.nombre = ?
       LIMIT 1`,
      [orden.codigo, orden.total, estado, orden.canal,
       `%${orden.cliente.split(' ')[0]}%`, prod.cat]
    ).catch(() => {}); // Silencioso si falla (datos demo)

    io.to('dashboard').emit('nueva_orden', orden);
    console.log(`📦 Orden simulada emitida: ${orden.codigo} — ${estado}`);

    // Siguiente simulación en 15-45 segundos
    setTimeout(simularOrden, randInt(15000, 45000));
  }

  // Comenzar simulación tras 10 segundos
  setTimeout(simularOrden, 10000);

  // ── Actualización de KPIs cada 30 segundos ────────────────
  setInterval(async () => {
    try {
      const [[kpis]] = await pool.execute(`
        SELECT
          COALESCE(SUM(CASE WHEN estado='Completado' AND creado_en >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN total ELSE 0 END),0) AS ventas,
          COUNT(CASE WHEN creado_en >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) AS ordenes,
          COUNT(DISTINCT CASE WHEN creado_en >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN cliente_id END) AS clientes
        FROM ordenes
      `);

      io.to('dashboard').emit('kpi_update', {
        ventas:   parseFloat(kpis.ventas),
        ordenes:  parseInt(kpis.ordenes),
        clientes: parseInt(kpis.clientes),
        timestamp: new Date().toISOString(),
      });
    } catch {}
  }, 30000);

  return io;
};
