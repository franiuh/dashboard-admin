/**
 * routes/export.js — Exportar datos reales desde MySQL
 * GET /api/export?tipo=ordenes|ventas|productos&filtros...
 * GET /api/export/excel
 * GET /api/export/csv
 */
const router  = require('express').Router();
const pool    = require('../db/pool');
const ExcelJS = require('exceljs');
const { authMiddleware } = require('../middleware/auth');

// ─── GET /api/export/excel ────────────────────────────────
router.get('/excel', authMiddleware, async (req, res) => {
  const { estado, categoria, canal, desde, hasta, periodo } = req.query;

  const where  = [];
  const params = [];

  if (estado)    { where.push('o.estado = ?');           params.push(estado);   }
  if (categoria) { where.push('c.slug = ?');             params.push(categoria);}
  if (canal)     { where.push('o.canal = ?');            params.push(canal);    }
  if (desde)     { where.push('DATE(o.creado_en) >= ?'); params.push(desde);    }
  if (hasta)     { where.push('DATE(o.creado_en) <= ?'); params.push(hasta);    }
  if (periodo && !desde && !hasta) {
    where.push('o.creado_en >= DATE_SUB(NOW(), INTERVAL ? DAY)');
    params.push(parseInt(periodo));
  }

  const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';

  try {
    const [ordenes] = await pool.execute(`
      SELECT o.codigo, cl.nombre AS cliente, cl.email,
             c.nombre AS categoria, o.total, o.estado, o.canal,
             DATE_FORMAT(o.creado_en, '%d/%m/%Y %H:%i') AS fecha
      FROM ordenes o
      JOIN clientes cl   ON o.cliente_id   = cl.id
      JOIN categorias c  ON o.categoria_id = c.id
      ${whereSQL}
      ORDER BY o.creado_en DESC
      LIMIT 5000
    `, params);

    const [resumen] = await pool.execute(`
      SELECT
        COUNT(*) AS total_ordenes,
        SUM(CASE WHEN estado='Completado' THEN total ELSE 0 END) AS ventas_totales,
        SUM(CASE WHEN estado='Completado' THEN 1 ELSE 0 END) AS completadas,
        SUM(CASE WHEN estado='Cancelado'  THEN 1 ELSE 0 END) AS canceladas,
        SUM(CASE WHEN estado='Pendiente'  THEN 1 ELSE 0 END) AS pendientes
      FROM ordenes o
      JOIN categorias c ON o.categoria_id = c.id
      ${whereSQL}
    `, params);

    // ── Generar Excel con ExcelJS ──────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Francisca Villalba — Dashboard Administrativo';
    wb.created = new Date();

    // Hoja 1: Órdenes
    const ws1 = wb.addWorksheet('Órdenes', {
      pageSetup: { fitToPage: true, fitToWidth: 1 },
    });

    // Estilos
    const headerFill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF9B8ECC' } };
    const headerFont = { bold: true, color:{ argb:'FFFFFFFF' }, size: 11 };
    const titleFont  = { bold: true, size: 14, color:{ argb:'FF3D3060' } };
    const altFill    = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFF7F5FF' } };

    // Título
    ws1.mergeCells('A1:H1');
    ws1.getCell('A1').value = 'Dashboard Administrativo — Reporte de Órdenes';
    ws1.getCell('A1').font  = titleFont;
    ws1.getCell('A1').alignment = { horizontal:'center' };
    ws1.getRow(1).height = 30;

    ws1.mergeCells('A2:H2');
    ws1.getCell('A2').value = `Generado: ${new Date().toLocaleString('es-CL')} | Filtros: ${[estado,categoria,canal,desde,hasta].filter(Boolean).join(', ') || 'Ninguno'}`;
    ws1.getCell('A2').font  = { italic:true, color:{ argb:'FF8A8A9A' }, size:10 };
    ws1.getCell('A2').alignment = { horizontal:'center' };

    ws1.addRow([]);

    // Headers
    const headers = ['Código','Cliente','Email','Categoría','Total (CLP)','Estado','Canal','Fecha'];
    const headerRow = ws1.addRow(headers);
    headerRow.eachCell(cell => {
      cell.fill = headerFill;
      cell.font = headerFont;
      cell.alignment = { horizontal:'center', vertical:'middle' };
      cell.border = { bottom:{ style:'thin', color:{ argb:'FF7B6BBF' } } };
    });
    ws1.getRow(4).height = 22;

    // Datos
    const estadoColors = {
      'Completado': 'FF6DCBA8', 'Pendiente': 'FFE8C53A',
      'En proceso': 'FF6AB8E8', 'Cancelado':  'FFE87FA8',
    };

    ordenes.forEach((o, i) => {
      const row = ws1.addRow([
        o.codigo, o.cliente, o.email, o.categoria,
        parseFloat(o.total), o.estado, o.canal, o.fecha,
      ]);
      if (i % 2 === 1) {
        row.eachCell(cell => { cell.fill = altFill; });
      }
      // Color del estado
      const estCell = row.getCell(6);
      const color = estadoColors[o.estado] || 'FFCCCCCC';
      estCell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb: color } };
      estCell.font = { bold:true, size:10 };
      estCell.alignment = { horizontal:'center' };

      // Formato número
      row.getCell(5).numFmt = '#,##0';
    });

    // Anchos de columna
    ws1.columns = [
      {width:14},{width:24},{width:28},{width:14},
      {width:16},{width:14},{width:12},{width:20},
    ];

    // Auto-filter
    ws1.autoFilter = { from:'A4', to:`H${4 + ordenes.length}` };

    // Fila total
    const totalRow = ws1.addRow(['','','','TOTAL',
      { formula: `SUM(E5:E${4+ordenes.length})` },'','','']);
    totalRow.font = { bold:true };
    totalRow.getCell(5).numFmt = '#,##0';

    // Hoja 2: Resumen
    const ws2 = wb.addWorksheet('Resumen');
    const r   = resumen[0];
    ws2.mergeCells('A1:B1');
    ws2.getCell('A1').value = 'Resumen ejecutivo';
    ws2.getCell('A1').font  = titleFont;
    ws2.getRow(1).height = 28;

    const summaryData = [
      ['Total órdenes',   parseInt(r.total_ordenes)],
      ['Ventas netas',    { v: parseFloat(r.ventas_totales), fmt:'#,##0' }],
      ['Completadas',     parseInt(r.completadas)],
      ['Pendientes',      parseInt(r.pendientes)],
      ['Canceladas',      parseInt(r.canceladas)],
      ['Tasa éxito',      { v: r.total_ordenes > 0
        ? (r.completadas / r.total_ordenes * 100).toFixed(1) + '%' : '0%' }],
    ];

    summaryData.forEach(([label, val]) => {
      const row = ws2.addRow([label, typeof val === 'object' ? val.v : val]);
      row.getCell(1).font = { bold:true, color:{ argb:'FF9B8ECC' } };
      if (typeof val === 'object' && val.fmt) {
        row.getCell(2).numFmt = val.fmt;
      }
    });
    ws2.columns = [{width:20},{width:20}];

    // Enviar respuesta
    const fecha = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="dashboard_${fecha}.xlsx"`);

    await wb.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('[EXPORT EXCEL]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── GET /api/export/csv ──────────────────────────────────
router.get('/csv', authMiddleware, async (req, res) => {
  const { estado, categoria, periodo } = req.query;
  const where = [];
  const params = [];

  if (estado) { where.push('o.estado = ?'); params.push(estado); }
  if (categoria) { where.push('c.slug = ?'); params.push(categoria); }
  if (periodo) {
    where.push('o.creado_en >= DATE_SUB(NOW(), INTERVAL ? DAY)');
    params.push(parseInt(periodo));
  }

  const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';

  try {
    const [rows] = await pool.execute(`
      SELECT o.codigo, cl.nombre AS cliente, c.nombre AS categoria,
             o.total, o.estado, o.canal,
             DATE_FORMAT(o.creado_en, '%d/%m/%Y') AS fecha
      FROM ordenes o
      JOIN clientes cl ON o.cliente_id = cl.id
      JOIN categorias c ON o.categoria_id = c.id
      ${whereSQL}
      ORDER BY o.creado_en DESC
      LIMIT 5000
    `, params);

    const csv = [
      ['Código','Cliente','Categoría','Total','Estado','Canal','Fecha'].join(','),
      ...rows.map(r => [r.codigo, `"${r.cliente}"`, `"${r.categoria}"`, r.total, r.estado, r.canal, r.fecha].join(','))
    ].join('\n');

    const fecha = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ordenes_${fecha}.csv"`);
    res.send('\uFEFF' + csv);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
