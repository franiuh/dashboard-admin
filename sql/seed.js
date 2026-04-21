/**
 * seed.js — Poblar base de datos con datos realistas
 * Ejecutar: node sql/seed.js
 */
console.log("🌱 Ejecutando seed...");
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql  = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const DB_CONFIG = {
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 3306,
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'dashboard_db',
  multipleStatements: true,
};

const categorias = [
  { nombre: 'Electrónica', slug: 'electronica' },
  { nombre: 'Ropa',        slug: 'ropa'        },
  { nombre: 'Hogar',       slug: 'hogar'       },
  { nombre: 'Deporte',     slug: 'deporte'     },
];

const productosBase = [
  { nombre: 'Smart TV 55"',       sku: 'EL001', cat: 1, precio: 349990, stock: 45,  min: 50 },
  { nombre: 'Audífonos BT Pro',   sku: 'EL002', cat: 1, precio: 79990,  stock: 120, min: 30 },
  { nombre: 'Tablet Pro 11"',     sku: 'EL003', cat: 1, precio: 449990, stock: 30,  min: 40 },
  { nombre: 'Cámara DSLR',        sku: 'EL004', cat: 1, precio: 599990, stock: 18,  min: 20 },
  { nombre: 'Chaqueta Invierno',  sku: 'RO001', cat: 2, precio: 89990,  stock: 200, min: 50 },
  { nombre: 'Vestido Floral',     sku: 'RO002', cat: 2, precio: 45990,  stock: 150, min: 40 },
  { nombre: 'Zapatos Cuero',      sku: 'RO003', cat: 2, precio: 94990,  stock: 80,  min: 30 },
  { nombre: 'Abrigo Lana',        sku: 'RO004', cat: 2, precio: 129990, stock: 22,  min: 30 },
  { nombre: 'Set Cuchillos',      sku: 'HO001', cat: 3, precio: 54990,  stock: 60,  min: 25 },
  { nombre: 'Aspiradora Robot',   sku: 'HO002', cat: 3, precio: 199990, stock: 35,  min: 20 },
  { nombre: 'Lámpara Minimalista',sku: 'HO003', cat: 3, precio: 39990,  stock: 90,  min: 30 },
  { nombre: 'Cafetera Espresso',  sku: 'HO004', cat: 3, precio: 149990, stock: 42,  min: 25 },
  { nombre: 'Zapatillas Running', sku: 'DE001', cat: 4, precio: 119990, stock: 110, min: 40 },
  { nombre: 'Bicicleta Spinning', sku: 'DE002', cat: 4, precio: 289990, stock: 15,  min: 10 },
  { nombre: 'Set Pesas 20kg',     sku: 'DE003', cat: 4, precio: 64990,  stock: 55,  min: 20 },
];

const nombres = ['María González','Carlos Ruiz','Ana Morales','Luis Vega','Sofía Castro',
  'Pedro Díaz','Valentina López','Andrés Torres','Camila Reyes','Matías Soto',
  'Isidora Muñoz','Rodrigo Parra','Francisca Vargas','Tomás Herrera','Javiera Núñez',
  'Felipe Araya','Constanza Pérez','Nicolás Rojas','Daniela Silva','Sebastián Fuentes'];

const emails = nombres.map(n => n.toLowerCase().replace(/ /g,'.')
  .normalize('NFD').replace(/[\u0300-\u036f]/g,'') + '@email.cl');

const canales  = ['Online','Marketplace','Local','App'];
const estados  = ['Completado','Completado','Completado','Pendiente','En proceso','Cancelado'];
const ciudades = ['Santiago','Valparaíso','Concepción','Antofagasta','Temuco','Iquique'];

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function fechaHaceDias(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  // Hora aleatoria
  d.setHours(randInt(8,22), randInt(0,59), randInt(0,59));
  return d.toISOString().slice(0,19).replace('T',' ');
}

async function seed() {
  const conn = await mysql.createConnection(DB_CONFIG);
  console.log('✅ Conectado a MySQL');

  try {
    await conn.execute('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['refresh_tokens','alertas','ventas_diarias','orden_items','ordenes','clientes','productos','categorias','usuarios']) {
      await conn.execute(`TRUNCATE TABLE ${t}`);
    }
    await conn.execute('SET FOREIGN_KEY_CHECKS = 1');
    console.log('🗑  Tablas limpiadas');

    // Usuarios
    const passAdmin  = await bcrypt.hash('Admin123!', 12);
    const passViewer = await bcrypt.hash('Viewer123!', 12);
    await conn.execute(
      `INSERT INTO usuarios (nombre, email, password, rol) VALUES
       ('Francisca Villalba', 'admin@dashboard.cl', ?, 'admin'),
       ('Viewer Demo',        'viewer@dashboard.cl', ?, 'viewer')`,
      [passAdmin, passViewer]
    );
    console.log('👤 Usuarios creados');

    // Categorías
    for (const c of categorias) {
      await conn.execute('INSERT INTO categorias (nombre, slug) VALUES (?,?)', [c.nombre, c.slug]);
    }

    // Productos
    for (const p of productosBase) {
      await conn.execute(
        'INSERT INTO productos (nombre, sku, categoria_id, precio, stock, stock_minimo) VALUES (?,?,?,?,?,?)',
        [p.nombre, p.sku, p.cat, p.precio, p.stock, p.min]
      );
    }
    console.log('📦 Productos creados');

    // Clientes
    for (let i = 0; i < nombres.length; i++) {
      await conn.execute(
        'INSERT INTO clientes (nombre, email, ciudad) VALUES (?,?,?)',
        [nombres[i], emails[i], rand(ciudades)]
      );
    }
    console.log('👥 Clientes creados');

    // Órdenes (180 días de historial)
    let ordenNum = 8600;
    const ordenesInsert = [];
    for (let dia = 179; dia >= 0; dia--) {
      const cantOrdenes = randInt(4, 18);
      for (let j = 0; j < cantOrdenes; j++) {
        ordenNum++;
        const clienteId = randInt(1, nombres.length);
        const prod      = rand(productosBase);
        const estado    = rand(estados);
        const canal     = rand(canales);
        const fecha     = fechaHaceDias(dia);
        const total     = prod.precio * randInt(1,3) * (1 + (Math.random() * 0.3 - 0.1));
        ordenesInsert.push([
          `ORD-${ordenNum}`, clienteId, Math.round(total),
          estado, canal, prod.cat, fecha, fecha
        ]);
      }
    }

    for (const o of ordenesInsert) {
      await conn.execute(
        `INSERT INTO ordenes (codigo, cliente_id, total, estado, canal, categoria_id, creado_en, actualizado_en)
         VALUES (?,?,?,?,?,?,?,?)`, o
      );
    }
    console.log(`🛒 ${ordenesInsert.length} órdenes creadas`);

    // Ventas diarias (agregado)
    await conn.execute(`
      INSERT INTO ventas_diarias (fecha, total, ordenes)
      SELECT DATE(creado_en) as fecha,
             SUM(CASE WHEN estado='Completado' THEN total ELSE 0 END) as total,
             COUNT(*) as ordenes
      FROM ordenes
      GROUP BY DATE(creado_en)
      ON DUPLICATE KEY UPDATE total=VALUES(total), ordenes=VALUES(ordenes)
    `);
    console.log('📊 Ventas diarias calculadas');

    // Alertas iniciales
    await conn.execute(`
      INSERT INTO alertas (tipo, mensaje, nivel) VALUES
      ('stock',   'Producto "Smart TV 55\\"" bajo stock mínimo (45 uds)', 'warning'),
      ('stock',   'Producto "Bicicleta Spinning" en nivel crítico (15 uds)', 'danger'),
      ('ventas',  'Ventas de canal App aumentaron 18% esta semana', 'info'),
      ('sistema', 'Dashboard iniciado correctamente', 'info')
    `);
    console.log('🔔 Alertas creadas');

    console.log('\n✨ Seed completado exitosamente!');
    console.log('─────────────────────────────────────');
    console.log('  Admin:  admin@dashboard.cl  / Admin123!');
    console.log('  Viewer: viewer@dashboard.cl / Viewer123!');
    console.log('─────────────────────────────────────');

  } finally {
    await conn.end();
  }
}

seed().catch(err => { console.error('❌ Error en seed:', err); process.exit(1); });
