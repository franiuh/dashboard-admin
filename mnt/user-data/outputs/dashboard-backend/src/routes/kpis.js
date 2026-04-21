/**
 * routes/kpis.js — Métricas principales del dashboard
 * GET /api/kpis?periodo=30&categoria=electronica
 */
const router = require('express').Router();
const pool   = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, async (req, res) => {
  const periodo  = parseInt(req.query.periodo)  || 30;   // días
  const categoria = req.query.categoria || 'all';

  const catFilter = categoria !== 'all'
    ? `AND c.slug = ${pool.escape(categoria)}`
    : '';

  try {
    const [
      [ventasActual],
      [ventasAnterior],
      [ordenes],
      [clientes],
      [stock],
      [devolucion],
      [satisfaccion],
      [canales],
      [ventasPorDia],
      [porCategoria],
    ] = await Promise.all([

      // 1. Ventas período actual
      pool.execute(`
        SELECT COALESCE(SUM(o.total), 0) AS total, COUNT(*) AS count
        FROM ordenes o
        LEFT JOIN categorias c ON o.categoria_id = c.id
        WHERE o.estado = 'Completado'
          AND o.creado_en >= DATE_SUB(NOW(), INTERVAL ? DAY)
          ${catFilter}
      `, [periodo]),

      // 2. Ventas período anterior (para calcular % cambio)
      pool.execute(`
        SELECT COALESCE(SUM(o.total), 0) AS total
        FROM ordenes o
        LEFT JOIN categorias c ON o.categoria_id = c.id
        WHERE o.estado = 'Completado'
          AND o.creado_en >= DATE_SUB(NOW(), INTERVAL ? DAY)
          AND o.creado_en <  DATE_SUB(NOW(), INTERVAL ? DAY)
          ${catFilter}
      `, [periodo * 2, periodo]),

      // 3. Total órdenes período
      pool.execute(`
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN estado='Completado'  THEN 1 ELSE 0 END) AS completadas,
               SUM(CASE WHEN estado='Pendiente'   THEN 1 ELSE 0 END) AS pendientes,
               SUM(CASE WHEN estado='En proceso'  THEN 1 ELSE 0 END) AS en_proceso,
               SUM(CASE WHEN estado='Cancelado'   THEN 1 ELSE 0 END) AS canceladas
        FROM ordenes o
        LEFT JOIN categorias c ON o.categoria_id = c.id
        WHERE o.creado_en >= DATE_SUB(NOW(), INTERVAL ? DAY) ${catFilter}
      `, [periodo]),

      // 4. Clientes activos
      pool.execute(`
        SELECT COUNT(DISTINCT o.cliente_id) AS activos,
               (SELECT COUNT(*) FROM clientes WHERE activo=1) AS total
        FROM ordenes o
        WHERE o.creado_en >= DATE_SUB(NOW(), INTERVAL ? DAY)
      `, [periodo]),

      // 5. Stock
      pool.execute(`
        SELECT SUM(stock) AS total_stock,
               SUM(CASE WHEN stock <= stock_minimo THEN 1 ELSE 0 END) AS bajo_minimo,
               COUNT(*) AS total_productos
        FROM productos WHERE activo = 1
      `),

      // 6. Tasa devolución (cancelados / total)
      pool.execute(`
        SELECT
          ROUND(
            SUM(CASE WHEN estado='Cancelado' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*),0)
          , 1) AS tasa
        FROM ordenes
        WHERE creado_en >= DATE_SUB(NOW(), INTERVAL ? DAY)
      `, [periodo]),

      // 7. Satisfacción simulada (basada en % completados)
      pool.execute(`
        SELECT ROUND(
          3.0 + (SUM(CASE WHEN estado='Completado' THEN 1 ELSE 0 END) * 2.0 / NULLIF(COUNT(*),0))
        , 1) AS score
        FROM ordenes
        WHERE creado_en >= DATE_SUB(NOW(), INTERVAL ? DAY)
      `, [periodo]),

      // 8. Ventas por canal
      pool.execute(`
        SELECT canal,
               COUNT(*) AS ordenes,
               COALESCE(SUM(CASE WHEN estado='Completado' THEN total ELSE 0 END),0) AS total
        FROM ordenes o
        LEFT JOIN categorias c ON o.categoria_id = c.id
        WHERE o.creado_en >= DATE_SUB(NOW(), INTERVAL ? DAY) ${catFilter}
        GROUP BY canal
        ORDER BY total DESC
      `, [periodo]),

      // 9. Ventas por día (para gráfico de líneas)
      pool.execute(`
        SELECT DATE(creado_en) AS fecha,
               COALESCE(SUM(CASE WHEN estado='Completado' THEN total ELSE 0 END),0) AS total,
               COUNT(*) AS ordenes
        FROM ordenes o
        LEFT JOIN categorias c ON o.categoria_id = c.id
        WHERE o.creado_en >= DATE_SUB(NOW(), INTERVAL ? DAY) ${catFilter}
        GROUP BY DATE(creado_en)
        ORDER BY fecha ASC
      `, [periodo]),

      // 10. Ventas por categoría
      pool.execute(`
        SELECT cat.nombre, cat.slug,
               COUNT(*) AS ordenes,
               COALESCE(SUM(CASE WHEN o.estado='Completado' THEN o.total ELSE 0 END),0) AS total
        FROM ordenes o
        JOIN categorias cat ON o.categoria_id = cat.id
        WHERE o.creado_en >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY cat.id, cat.nombre, cat.slug
        ORDER BY total DESC
      `, [periodo]),
    ]);

    const ventasAct  = parseFloat(ventasActual[0].total) || 0;
    const ventasAnt  = parseFloat(ventasAnterior[0].total) || 0;
    const cambioPct  = ventasAnt > 0
      ? ((ventasAct - ventasAnt) / ventasAnt * 100).toFixed(1)
      : 100;

    res.json({
      ok: true,
      periodo,
      categoria,
      kpis: {
        ventas: {
          total:        ventasAct,
          total_fmt:    formatCLP(ventasAct),
          cambio_pct:   parseFloat(cambioPct),
          cambio_dir:   cambioPct >= 0 ? 'up' : 'down',
        },
        ordenes: {
          total:        parseInt(ordenes[0].total),
          completadas:  parseInt(ordenes[0].completadas),
          pendientes:   parseInt(ordenes[0].pendientes),
          en_proceso:   parseInt(ordenes[0].en_proceso),
          canceladas:   parseInt(ordenes[0].canceladas),
        },
        clientes: {
          activos:      parseInt(clientes[0].activos),
          total:        parseInt(clientes[0].total),
        },
        stock: {
          total:        parseInt(stock[0].total_stock),
          bajo_minimo:  parseInt(stock[0].bajo_minimo),
          total_prods:  parseInt(stock[0].total_productos),
        },
        devolucion: {
          tasa: parseFloat(devolucion[0].tasa) || 0,
        },
        satisfaccion: {
          score: parseFloat(satisfaccion[0].score) || 0,
        },
      },
      graficos: {
        ventas_por_dia:      ventasPorDia,
        ventas_por_categoria: porCategoria,
        canales:              canales,
      },
    });
  } catch (err) {
    console.error('[KPIs]', err);
    res.status(500).json({ ok: false, error: 'Error al obtener KPIs', detalle: err.message });
  }
});

function formatCLP(n) {
  if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n/1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

module.exports = router;
