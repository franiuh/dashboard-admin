/**
 * routes/alertas.js — Alertas inteligentes del sistema
 * GET /api/alertas        — Listar alertas activas
 * POST /api/alertas/check — Ejecutar chequeo de alertas
 * PUT  /api/alertas/:id/leer
 */
const router = require('express').Router();
const pool   = require('../config/db');
const { authMiddleware, roles } = require('../middleware/auth');

// ─── GET /api/alertas ─────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const [alertas] = await pool.execute(`
      SELECT id, tipo, mensaje, nivel, leida,
             DATE_FORMAT(creado_en, '%d/%m/%Y %H:%i') AS creado_en
      FROM alertas
      ORDER BY leida ASC, creado_en DESC
      LIMIT 50
    `);

    const [[{ no_leidas }]] = await pool.execute(
      'SELECT COUNT(*) AS no_leidas FROM alertas WHERE leida = 0'
    );

    res.json({ ok: true, alertas, no_leidas: parseInt(no_leidas) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── POST /api/alertas/check — Motor de alertas inteligentes
router.post('/check', authMiddleware, roles('admin'), async (req, res) => {
  const nuevasAlertas = [];
  const conn = await pool.getConnection();

  try {
    // 1. Productos bajo stock mínimo
    const [stockBajo] = await conn.execute(`
      SELECT nombre, stock, stock_minimo
      FROM productos
      WHERE stock <= stock_minimo AND activo = 1
    `);

    for (const p of stockBajo) {
      const nivel    = p.stock <= Math.floor(p.stock_minimo * 0.3) ? 'danger' : 'warning';
      const mensaje  = `"${p.nombre}" bajo stock mínimo: ${p.stock} uds (mín: ${p.stock_minimo})`;

      // Evitar duplicados recientes (últimas 24h)
      const [[dup]] = await conn.execute(`
        SELECT id FROM alertas
        WHERE tipo='stock' AND mensaje=? AND creado_en >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        LIMIT 1
      `, [mensaje]);

      if (!dup) {
        await conn.execute(
          'INSERT INTO alertas (tipo, mensaje, nivel) VALUES (?,?,?)',
          ['stock', mensaje, nivel]
        );
        nuevasAlertas.push({ tipo:'stock', mensaje, nivel });
      }
    }

    // 2. Ventas caída >20% vs semana anterior
    const [[ventasSemAct]] = await conn.execute(`
      SELECT COALESCE(SUM(CASE WHEN estado='Completado' THEN total ELSE 0 END), 0) AS total
      FROM ordenes
      WHERE creado_en >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);
    const [[ventasSemAnt]] = await conn.execute(`
      SELECT COALESCE(SUM(CASE WHEN estado='Completado' THEN total ELSE 0 END), 0) AS total
      FROM ordenes
      WHERE creado_en >= DATE_SUB(NOW(), INTERVAL 14 DAY)
        AND creado_en <  DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);

    const totalAct = parseFloat(ventasSemAct.total);
    const totalAnt = parseFloat(ventasSemAnt.total);
    const threshold = parseFloat(process.env.VENTAS_CAIDA_PORCENTAJE || 20);

    if (totalAnt > 0 && totalAct < totalAnt) {
      const caida = ((totalAnt - totalAct) / totalAnt * 100);
      if (caida >= threshold) {
        const mensaje = `Alerta: ventas cayeron ${caida.toFixed(1)}% esta semana vs la anterior`;
        const [[dup]] = await conn.execute(`
          SELECT id FROM alertas WHERE tipo='ventas' AND mensaje=?
          AND creado_en >= DATE_SUB(NOW(), INTERVAL 24 HOUR) LIMIT 1
        `, [mensaje]);
        if (!dup) {
          await conn.execute('INSERT INTO alertas (tipo, mensaje, nivel) VALUES (?,?,?)',
            ['ventas', mensaje, 'danger']);
          nuevasAlertas.push({ tipo:'ventas', mensaje, nivel:'danger' });
        }
      }
    }

    // 3. Alerta de alto volumen de cancelaciones
    const [[cancelaciones]] = await conn.execute(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN estado='Cancelado' THEN 1 ELSE 0 END) AS canceladas
      FROM ordenes
      WHERE creado_en >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);
    const tasaCancel = parseInt(cancelaciones.canceladas) / parseInt(cancelaciones.total) * 100;
    if (tasaCancel > 15) {
      const mensaje = `Tasa de cancelación alta esta semana: ${tasaCancel.toFixed(1)}%`;
      await conn.execute('INSERT IGNORE INTO alertas (tipo, mensaje, nivel) VALUES (?,?,?)',
        ['ventas', mensaje, 'warning']);
      nuevasAlertas.push({ tipo:'ventas', mensaje, nivel:'warning' });
    }

    // Emitir por socket si hay nuevas alertas
    if (nuevasAlertas.length > 0 && req.app.get('io')) {
      req.app.get('io').emit('nuevas_alertas', nuevasAlertas);
    }

    res.json({ ok: true, nuevas: nuevasAlertas.length, alertas: nuevasAlertas });
  } catch (err) {
    console.error('[ALERTAS CHECK]', err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    conn.release();
  }
});

// ─── PUT /api/alertas/:id/leer ────────────────────────────
router.put('/:id/leer', authMiddleware, async (req, res) => {
  await pool.execute('UPDATE alertas SET leida = 1 WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// ─── PUT /api/alertas/leer-todas ─────────────────────────
router.put('/leer-todas', authMiddleware, async (req, res) => {
  await pool.execute('UPDATE alertas SET leida = 1');
  res.json({ ok: true, mensaje: 'Todas las alertas marcadas como leídas' });
});

module.exports = router;
