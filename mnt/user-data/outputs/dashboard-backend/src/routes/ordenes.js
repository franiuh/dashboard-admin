/**
 * routes/ordenes.js — CRUD de órdenes con filtros SQL dinámicos
 * GET  /api/ordenes?estado=&categoria=&canal=&q=&page=&limit=
 * GET  /api/ordenes/:id
 * POST /api/ordenes          (solo admin)
 * PUT  /api/ordenes/:id      (solo admin)
 */
const router = require('express').Router();
const pool   = require('../config/db');
const { authMiddleware, roles } = require('../middleware/auth');

// ─── GET /api/ordenes ─────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  const page     = Math.max(1, parseInt(req.query.page)  || 1);
  const limit    = Math.min(100, parseInt(req.query.limit) || 10);
  const offset   = (page - 1) * limit;
  const estado   = req.query.estado   || '';
  const cat      = req.query.categoria || '';
  const canal    = req.query.canal    || '';
  const q        = req.query.q        || '';
  const desde    = req.query.desde    || '';
  const hasta    = req.query.hasta    || '';

  // Construir filtros dinámicos
  const where  = [];
  const params = [];

  if (estado) { where.push('o.estado = ?');        params.push(estado); }
  if (cat)    { where.push('c.slug = ?');           params.push(cat);   }
  if (canal)  { where.push('o.canal = ?');          params.push(canal); }
  if (q)      { where.push('(o.codigo LIKE ? OR cl.nombre LIKE ? OR p.nombre LIKE ?)');
                params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (desde)  { where.push('DATE(o.creado_en) >= ?'); params.push(desde); }
  if (hasta)  { where.push('DATE(o.creado_en) <= ?'); params.push(hasta); }

  const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const baseQuery = `
    FROM ordenes o
    JOIN clientes   cl ON o.cliente_id   = cl.id
    JOIN categorias c  ON o.categoria_id = c.id
    LEFT JOIN orden_items oi ON oi.orden_id = o.id
    LEFT JOIN productos   p  ON oi.producto_id = p.id
    ${whereSQL}
  `;

  try {
    const [[countRow]] = await pool.execute(
      `SELECT COUNT(DISTINCT o.id) AS total ${baseQuery}`,
      params
    );

    const [rows] = await pool.execute(
      `SELECT DISTINCT
         o.id, o.codigo, cl.nombre AS cliente, cl.email AS cliente_email,
         c.nombre AS categoria, c.slug AS categoria_slug,
         o.total, o.estado, o.canal,
         DATE_FORMAT(o.creado_en, '%d/%m/%Y %H:%i') AS creado_en,
         DATE_FORMAT(o.actualizado_en, '%d/%m/%Y %H:%i') AS actualizado_en
       ${baseQuery}
       ORDER BY o.creado_en DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const total = parseInt(countRow.total);

    res.json({
      ok: true,
      data:        rows,
      paginacion: {
        total,
        pagina:      page,
        limite:      limit,
        total_pags:  Math.ceil(total / limit),
        tiene_prev:  page > 1,
        tiene_next:  page < Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('[ORDENES GET]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── GET /api/ordenes/:id ─────────────────────────────────
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const [[orden]] = await pool.execute(`
      SELECT o.*, cl.nombre AS cliente, cl.email, cl.ciudad,
             c.nombre AS categoria
      FROM ordenes o
      JOIN clientes   cl ON o.cliente_id   = cl.id
      JOIN categorias c  ON o.categoria_id = c.id
      WHERE o.id = ?
    `, [req.params.id]);

    if (!orden) return res.status(404).json({ ok: false, error: 'Orden no encontrada' });

    const [items] = await pool.execute(`
      SELECT oi.cantidad, oi.precio_unit, oi.subtotal,
             p.nombre AS producto, p.sku
      FROM orden_items oi
      JOIN productos p ON oi.producto_id = p.id
      WHERE oi.orden_id = ?
    `, [req.params.id]);

    res.json({ ok: true, orden: { ...orden, items } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── POST /api/ordenes (crear orden — solo admin) ─────────
router.post('/', authMiddleware, roles('admin'), async (req, res) => {
  const { cliente_id, categoria_id, total, estado, canal } = req.body;

  if (!cliente_id || !categoria_id || !total) {
    return res.status(400).json({ ok: false, error: 'Campos requeridos: cliente_id, categoria_id, total' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Generar código único
    const [[maxRow]] = await conn.execute('SELECT MAX(id) AS maxId FROM ordenes');
    const codigo = `ORD-${(maxRow.maxId || 8800) + 1}`;

    const [result] = await conn.execute(
      'INSERT INTO ordenes (codigo, cliente_id, categoria_id, total, estado, canal) VALUES (?,?,?,?,?,?)',
      [codigo, cliente_id, categoria_id, total, estado || 'Pendiente', canal || 'Online']
    );

    await conn.commit();

    const [[nueva]] = await conn.execute(`
      SELECT o.*, cl.nombre AS cliente, c.nombre AS categoria
      FROM ordenes o
      JOIN clientes   cl ON o.cliente_id   = cl.id
      JOIN categorias c  ON o.categoria_id = c.id
      WHERE o.id = ?
    `, [result.insertId]);

    // Emitir por Socket.io (si está disponible)
    if (req.app.get('io')) {
      req.app.get('io').emit('nueva_orden', nueva);
    }

    res.status(201).json({ ok: true, orden: nueva });
  } catch (err) {
    await conn.rollback();
    console.error('[ORDEN POST]', err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    conn.release();
  }
});

// ─── PUT /api/ordenes/:id (actualizar estado — solo admin) ─
router.put('/:id', authMiddleware, roles('admin'), async (req, res) => {
  const { estado } = req.body;
  const estadosValidos = ['Completado','Pendiente','En proceso','Cancelado'];

  if (!estadosValidos.includes(estado)) {
    return res.status(400).json({ ok: false, error: 'Estado inválido', validos: estadosValidos });
  }

  try {
    const [result] = await pool.execute(
      'UPDATE ordenes SET estado = ? WHERE id = ?',
      [estado, req.params.id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ ok: false, error: 'Orden no encontrada' });
    }

    if (req.app.get('io')) {
      req.app.get('io').emit('orden_actualizada', { id: req.params.id, estado });
    }

    res.json({ ok: true, mensaje: `Orden actualizada a "${estado}"` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
