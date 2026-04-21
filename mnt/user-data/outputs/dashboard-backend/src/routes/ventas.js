/**
 * routes/ventas.js — Datos de ventas con predicción
 * GET /api/ventas?periodo=30&categoria=all
 * GET /api/ventas/mensual?anio=2025
 * GET /api/ventas/prediccion
 */
const router = require('express').Router();
const pool   = require('../config/db');
const { authMiddleware, roles } = require('../middleware/auth');

// ─── GET /api/ventas ──────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  const periodo   = parseInt(req.query.periodo) || 30;
  const categoria = req.query.categoria || 'all';
  const catFilter = categoria !== 'all'
    ? `AND c.slug = ${pool.escape(categoria)}` : '';

  try {
    const [rows] = await pool.execute(`
      SELECT
        DATE(o.creado_en) AS fecha,
        cat.nombre        AS categoria,
        cat.slug,
        o.canal,
        COUNT(*)          AS total_ordenes,
        SUM(CASE WHEN o.estado='Completado' THEN o.total ELSE 0 END) AS ventas,
        SUM(CASE WHEN o.estado='Cancelado'  THEN 1       ELSE 0 END) AS canceladas
      FROM ordenes o
      JOIN categorias cat ON o.categoria_id = cat.id
      LEFT JOIN categorias c ON o.categoria_id = c.id
      WHERE o.creado_en >= DATE_SUB(NOW(), INTERVAL ? DAY) ${catFilter}
      GROUP BY DATE(o.creado_en), cat.id, o.canal
      ORDER BY fecha DESC
    `, [periodo]);

    res.json({ ok: true, data: rows, total: rows.length });
  } catch (err) {
    console.error('[VENTAS]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── GET /api/ventas/mensual ──────────────────────────────
router.get('/mensual', authMiddleware, async (req, res) => {
  const anio = parseInt(req.query.anio) || new Date().getFullYear();

  try {
    const [actual] = await pool.execute(`
      SELECT
        MONTH(creado_en) AS mes,
        MONTHNAME(creado_en) AS nombre_mes,
        COALESCE(SUM(CASE WHEN estado='Completado' THEN total ELSE 0 END), 0) AS total,
        COUNT(*) AS ordenes
      FROM ordenes
      WHERE YEAR(creado_en) = ?
      GROUP BY MONTH(creado_en)
      ORDER BY mes ASC
    `, [anio]);

    const [anterior] = await pool.execute(`
      SELECT MONTH(creado_en) AS mes,
             COALESCE(SUM(CASE WHEN estado='Completado' THEN total ELSE 0 END), 0) AS total
      FROM ordenes
      WHERE YEAR(creado_en) = ?
      GROUP BY MONTH(creado_en)
    `, [anio - 1]);

    // Montar meses completos (1-12)
    const meses = Array.from({length:12}, (_,i) => {
      const m    = actual.find(r => r.mes === i+1) || { total: 0, ordenes: 0 };
      const mAnt = anterior.find(r => r.mes === i+1) || { total: 0 };
      return {
        mes:      i + 1,
        label:    ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][i],
        actual:   parseFloat(m.total),
        anterior: parseFloat(mAnt.total),
        ordenes:  parseInt(m.ordenes) || 0,
      };
    });

    res.json({ ok: true, anio, anioAnterior: anio - 1, meses });
  } catch (err) {
    console.error('[VENTAS MENSUAL]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── GET /api/ventas/prediccion ───────────────────────────
// Predicción simple: regresión lineal sobre los últimos 60 días
router.get('/prediccion', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT DATE(creado_en) AS fecha,
             COALESCE(SUM(CASE WHEN estado='Completado' THEN total ELSE 0 END), 0) AS total
      FROM ordenes
      WHERE creado_en >= DATE_SUB(NOW(), INTERVAL 60 DAY)
      GROUP BY DATE(creado_en)
      ORDER BY fecha ASC
    `);

    if (rows.length < 7) {
      return res.json({ ok: true, prediccion: [], mensaje: 'Datos insuficientes para predicción' });
    }

    // Regresión lineal simple
    const n = rows.length;
    const xs = rows.map((_, i) => i);
    const ys = rows.map(r => parseFloat(r.total));
    const sumX  = xs.reduce((a,b) => a+b, 0);
    const sumY  = ys.reduce((a,b) => a+b, 0);
    const sumXY = xs.reduce((a,b,i) => a + b*ys[i], 0);
    const sumX2 = xs.reduce((a,b) => a + b*b, 0);
    const slope = (n*sumXY - sumX*sumY) / (n*sumX2 - sumX**2);
    const intercept = (sumY - slope*sumX) / n;

    // Próximos 14 días
    const prediccion = Array.from({length:14}, (_, i) => {
      const x    = n + i;
      const fecha = new Date();
      fecha.setDate(fecha.getDate() + i + 1);
      const pred = Math.max(0, intercept + slope * x);
      const varianza = pred * 0.12; // ±12% intervalo de confianza
      return {
        fecha:     fecha.toISOString().split('T')[0],
        predicho:  Math.round(pred),
        min:       Math.round(pred - varianza),
        max:       Math.round(pred + varianza),
      };
    });

    // Tendencia
    const tendencia = slope > 0 ? 'alza' : slope < 0 ? 'baja' : 'estable';
    const pct7dias  = rows.slice(-7).reduce((a,r) => a + parseFloat(r.total), 0);
    const pct14dias = rows.slice(-14,-7).reduce((a,r) => a + parseFloat(r.total), 0);
    const cambio7d  = pct14dias > 0 ? ((pct7dias - pct14dias)/pct14dias*100).toFixed(1) : 0;

    res.json({
      ok: true,
      tendencia,
      cambio_7d_pct: parseFloat(cambio7d),
      slope: parseFloat(slope.toFixed(2)),
      historico: rows.map(r => ({ fecha: r.fecha, total: parseFloat(r.total) })),
      prediccion,
    });
  } catch (err) {
    console.error('[PREDICCION]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
