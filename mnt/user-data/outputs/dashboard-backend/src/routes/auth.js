/**
 * routes/auth.js — Login, refresh token, logout
 */
const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool     = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

function signAccess(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });
}
function signRefresh(payload) {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });
}

// ─── POST /api/auth/login ─────────────────────────────────
router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ ok: false, errores: errors.array() });
    }

    const { email, password } = req.body;

    try {
      const [rows] = await pool.execute(
        'SELECT id, nombre, email, password, rol, activo FROM usuarios WHERE email = ? LIMIT 1',
        [email]
      );

      const user = rows[0];

      if (!user || !user.activo) {
        return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
      }

      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
      }

      // Actualizar último login
      await pool.execute('UPDATE usuarios SET ultimo_login = NOW() WHERE id = ?', [user.id]);

      const payload = { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol };
      const accessToken  = signAccess(payload);
      const refreshToken = signRefresh({ id: user.id });

      // Guardar refresh token en DB
      const expira = new Date(Date.now() + 7 * 24 * 3600 * 1000);
      await pool.execute(
        'INSERT INTO refresh_tokens (usuario_id, token, expira_en) VALUES (?,?,?)',
        [user.id, refreshToken, expira.toISOString().slice(0,19).replace('T',' ')]
      );

      res.json({
        ok: true,
        accessToken,
        refreshToken,
        usuario: payload,
        expiraEn: process.env.JWT_EXPIRES_IN || '8h',
      });
    } catch (err) {
      console.error('[AUTH LOGIN]', err);
      res.status(500).json({ ok: false, error: 'Error interno del servidor' });
    }
  }
);

// ─── POST /api/auth/refresh ───────────────────────────────
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(401).json({ ok: false, error: 'Refresh token requerido' });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    // Verificar que esté en DB y no expirado
    const [rows] = await pool.execute(
      'SELECT id FROM refresh_tokens WHERE token = ? AND usuario_id = ? AND expira_en > NOW()',
      [refreshToken, decoded.id]
    );

    if (!rows.length) {
      return res.status(401).json({ ok: false, error: 'Refresh token inválido o expirado' });
    }

    const [usuarios] = await pool.execute(
      'SELECT id, nombre, email, rol FROM usuarios WHERE id = ? AND activo = 1',
      [decoded.id]
    );

    if (!usuarios.length) {
      return res.status(401).json({ ok: false, error: 'Usuario no encontrado' });
    }

    const u = usuarios[0];
    const newAccess = signAccess({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol });

    res.json({ ok: true, accessToken: newAccess });
  } catch {
    res.status(401).json({ ok: false, error: 'Refresh token inválido' });
  }
});

// ─── POST /api/auth/logout ────────────────────────────────
router.post('/logout', authMiddleware, async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    await pool.execute('DELETE FROM refresh_tokens WHERE token = ?', [refreshToken]).catch(() => {});
  }
  res.json({ ok: true, mensaje: 'Sesión cerrada correctamente' });
});

// ─── GET /api/auth/me ─────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT id, nombre, email, rol, ultimo_login, creado_en FROM usuarios WHERE id = ?',
    [req.user.id]
  );
  res.json({ ok: true, usuario: rows[0] });
});

module.exports = router;
