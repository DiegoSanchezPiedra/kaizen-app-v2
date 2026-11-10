// src/middleware/slowLog.js — registra en consola las peticiones que pasan de SLOW_MS (sin query string: puede llevar datos).
const SLOW_MS = 500;

export function slowLog(req, res, next) {
  const start = performance.now();
  res.on('finish', () => {
    const ms = Math.round(performance.now() - start);
    if (ms > SLOW_MS) console.log(`[slow] ${req.method} ${req.originalUrl.split('?')[0]} → ${res.statusCode}, ${ms} ms`);
  });
  next();
}
