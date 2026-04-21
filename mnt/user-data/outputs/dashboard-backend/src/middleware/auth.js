/**
 * middleware/auth.js — Autenticación JWT + control de roles
 */
const jwt = require('jsonwebtoken');

/**
 * Verificar token JWT en el header Authorization
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      ok: false,
      error: 'Token de acceso requerido',
      code: 'NO_TOKEN',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;          // { id, nombre, email, rol, iat, exp }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ ok: false, error: 'Token expirado', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ ok: false, error: 'Token inválido', code: 'INVALID_TOKEN' });
  }
}

/**
 * Restringir a roles específicos
 * Uso: router.get('/ruta', auth, roles('admin'), handler)
 */
function roles(...rolesPermitidos) {
  return (req, res, next) => {
    if (!rolesPermitidos.includes(req.user?.rol)) {
      return res.status(403).json({
        ok: false,
        error: 'No tienes permiso para esta acción',
        code: 'FORBIDDEN',
        requerido: rolesPermitidos,
        actual: req.user?.rol,
      });
    }
    next();
  };
}

module.exports = { authMiddleware, roles };
