// src/middleware/errorHandler.js
export function notFound(req, res) {
  res.status(404).json({ error: 'not_found', path: req.originalUrl });
}

// Firma obligatoria de 4 args para que Express lo reconozca como error handler
export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const isProd = process.env.NODE_ENV === 'production';

  // Log siempre, pero sin volcar credenciales ni bodies sensibles
  console.error(`[error] ${req.method} ${req.originalUrl} → ${status}:`, err.message);
  if (!isProd && err.stack) console.error(err.stack);

  res.status(status).json({
    error: err.code || 'internal_error',
    message: isProd && status === 500 ? 'Error interno' : err.message,
    ...(err.details ? { details: err.details } : {}),
  });
}