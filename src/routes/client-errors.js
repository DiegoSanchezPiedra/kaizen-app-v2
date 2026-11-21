// src/routes/client-errors.js — POST /client-errors (sin token): el frontend manda aquí lo que enseña como «Algo ha fallado»
// (un 5xx, una respuesta que no es de la API, una excepción de JS o una pantalla que revienta), con la versión de la build.
// En el móvil no hay consola: sin esto, la causa real no quedaba en ningún sitio. Solo escribe una línea en el log. 204 siempre.
import { Router } from 'express';
import { rateLimit } from '../middleware/rateLimit.js';

const TEXT = { where: 40, code: 80, name: 80, message: 500, stack: 2000, version: 40, url: 300 };

// Una línea JSON con los campos conocidos, recortados; lo demás (o con otro tipo) se descarta: el cuerpo no es de fiar.
export function clientErrorLine(body, ua) {
  const b = body && typeof body === 'object' ? body : {};
  const out = { at: new Date().toISOString() };
  for (const [k, max] of Object.entries(TEXT)) if (typeof b[k] === 'string') out[k] = b[k].slice(0, max);
  if (Number.isInteger(b.status)) out.status = b.status;
  if (typeof b.standalone === 'boolean') out.standalone = b.standalone;
  if (typeof ua === 'string') out.ua = ua.slice(0, 200);
  return JSON.stringify(out);
}

const router = Router();
const limit = rateLimit({ name: 'client_errors', max: 30, windowMs: 15 * 60_000 });

router.post('/', limit, (req, res) => {
  console.warn(`[client-error] ${clientErrorLine(req.body, req.get('user-agent'))}`);
  res.status(204).end();
});

export default router;
