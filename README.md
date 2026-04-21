# 📊 Dashboard Administrativo — Francisca Villalba

> Sistema completo de gestión empresarial con API REST, MySQL, JWT y Socket.io en tiempo real.

---

## 🏗 Arquitectura

```
dashboard-backend/
├── src/
│   ├── index.js              ← Servidor Express + Socket.io
│   ├── db/pool.js            ← Pool de conexiones MySQL
│   ├── middleware/auth.js    ← JWT + control de roles
│   ├── routes/
│   │   ├── auth.js           ← POST /api/auth/login|refresh|logout
│   │   ├── kpis.js           ← GET  /api/kpis
│   │   ├── ventas.js         ← GET  /api/ventas, /mensual, /prediccion
│   │   ├── ordenes.js        ← CRUD /api/ordenes
│   │   ├── export.js         ← GET  /api/export/excel|csv
│   │   └── alertas.js        ← GET/POST /api/alertas
│   └── sockets/index.js      ← Eventos en tiempo real
├── sql/
│   ├── schema.sql            ← Esquema completo de MySQL
│   └── seed.js               ← Poblar con datos realistas
├── frontend/index.html       ← Frontend completo (HTML)
├── .env.example              ← Variables de entorno
└── package.json
```

---

## 🚀 Instalación paso a paso

### 1. Requisitos previos
- Node.js v18+ ([descargar](https://nodejs.org))
- MySQL 8.0+ ([descargar](https://dev.mysql.com/downloads/mysql/))

### 2. Clonar / descomprimir el proyecto
```bash
cd dashboard-backend
npm install
```

### 3. Configurar MySQL
```sql
-- Entrar a MySQL y ejecutar el esquema:
mysql -u root -p < sql/schema.sql
```
O manualmente en MySQL Workbench: abrir y ejecutar `sql/schema.sql`

### 4. Configurar variables de entorno
```bash
cp .env.example .env
```
Editar `.env`:
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=TU_PASSWORD
DB_NAME=dashboard_db
JWT_SECRET=cualquier_string_largo_y_seguro
JWT_REFRESH_SECRET=otro_string_diferente
```

### 5. Poblar con datos de prueba
```bash
npm run seed
```
Salida esperada:
```
✅ Conectado a MySQL
🗑  Tablas limpiadas
👤 Usuarios creados
📦 Productos creados
👥 Clientes creados
🛒 1847 órdenes creadas
📊 Ventas diarias calculadas
🔔 Alertas creadas

✨ Seed completado!
  Admin:  admin@dashboard.cl  / Admin123!
  Viewer: viewer@dashboard.cl / Viewer123!
```

### 6. Iniciar el servidor
```bash
# Desarrollo (con auto-reload)
npm run dev

# Producción
npm start
```

Verás:
```
╔══════════════════════════════════════════╗
║   Dashboard API — Francisca Villalba     ║
╠══════════════════════════════════════════╣
║  🚀  http://localhost:3001               ║
║  🔌  Socket.io activo                    ║
╚══════════════════════════════════════════╝
```

### 7. Abrir el frontend
Abrir `frontend/index.html` en tu navegador.
> ⚠️ Para evitar CORS en local, usa un servidor simple:
```bash
npx serve frontend -p 3000
# O simplemente abre el .html directamente en Chrome
```

---

## 📡 Endpoints de la API

### Autenticación
| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/login` | Login → devuelve JWT | ❌ |
| POST | `/api/auth/refresh` | Renovar access token | ❌ |
| POST | `/api/auth/logout` | Invalidar refresh token | ✅ |
| GET  | `/api/auth/me` | Info del usuario actual | ✅ |

### Dashboard
| Método | Endpoint | Descripción | Rol |
|--------|----------|-------------|-----|
| GET | `/api/kpis?periodo=30&categoria=all` | KPIs + gráficos | todos |
| GET | `/api/ventas?periodo=30` | Ventas por día | todos |
| GET | `/api/ventas/mensual?anio=2025` | Comparativo mensual | todos |
| GET | `/api/ventas/prediccion` | Predicción 14 días (regresión lineal) | todos |
| GET | `/api/ordenes?estado=&categoria=&page=1&limit=10&q=` | Órdenes paginadas con filtros SQL | todos |
| GET | `/api/ordenes/:id` | Detalle de orden | todos |
| POST | `/api/ordenes` | Crear orden | admin |
| PUT | `/api/ordenes/:id` | Cambiar estado | admin |
| GET | `/api/alertas` | Listar alertas | todos |
| POST | `/api/alertas/check` | Ejecutar motor de alertas | admin |
| GET | `/api/export/excel?periodo=&estado=&categoria=` | Exportar Excel real | todos |
| GET | `/api/export/csv` | Exportar CSV | todos |
| GET | `/api/health` | Estado del servidor | ❌ |

---

## ⚡ Funcionalidades en tiempo real (Socket.io)

Eventos emitidos desde el servidor:
- `nueva_orden` — Cuando se crea una orden (cada 15-45s en demo)
- `orden_actualizada` — Cuando cambia el estado de una orden
- `kpi_update` — KPIs recalculados cada 30 segundos
- `nuevas_alertas` — Alertas generadas por el motor

---

## 🔐 Autenticación y roles

| Característica | admin | viewer |
|---------------|-------|--------|
| Ver dashboard | ✅ | ✅ |
| Filtrar datos | ✅ | ✅ |
| Exportar Excel/CSV | ✅ | ✅ |
| Cambiar estado órdenes | ✅ | ❌ |
| Crear órdenes | ✅ | ❌ |
| Ejecutar motor de alertas | ✅ | ❌ |

---

## 🧠 Motor de predicción

El endpoint `/api/ventas/prediccion` aplica **regresión lineal** sobre los últimos 60 días de ventas históricas reales para proyectar los próximos 14 días con intervalo de confianza (±12%).

---

## 🔔 Sistema de alertas inteligentes

El endpoint `POST /api/alertas/check` verifica automáticamente:
1. **Stock bajo mínimo** — productos con stock ≤ stock_minimo
2. **Caída de ventas** — si caen >20% respecto a la semana anterior
3. **Tasa de cancelación** — alerta si supera el 15%

---

## 📦 Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Runtime | Node.js v18+ |
| Framework | Express.js 4.x |
| Base de datos | MySQL 8.0 |
| ORM/Driver | mysql2 |
| Autenticación | JWT (jsonwebtoken) |
| Tiempo real | Socket.io 4.x |
| Exportación | ExcelJS |
| Seguridad | Helmet, express-rate-limit, bcryptjs |
| Validación | express-validator |

---

## 🎯 Para el CV

> **"Dashboard administrativo full-stack con API REST (Node.js/Express), base de datos MySQL con consultas SQL dinámicas, autenticación JWT con control de acceso por roles (admin/viewer), actualización en tiempo real mediante Socket.io, predicción de ventas por regresión lineal y exportación de datos a Excel desde el servidor."**

---

Desarrollado por **Francisca Villalba** · 2025
