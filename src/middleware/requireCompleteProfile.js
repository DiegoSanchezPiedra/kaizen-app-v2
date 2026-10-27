// src/middleware/requireCompleteProfile.js
import { getProfileStatus } from '../services/profile.js';
import { httpError } from '../lib/errors.js';

/**
 * Guard de `withRlsContext`: bloquea si el alumno no tiene el perfil completo
 * (health info + 3 agreements en versión vigente + display_name) reutilizando
 * el `client` de la transacción.
 *
 * Uso (B7, B10):
 *   router.post('/bookings', requireAuth,
 *     withRlsContext(handler, { guards: [requireCompleteProfile] }));
 *
 * Falla con 403 { error: 'forbidden', code: 'profile_incomplete', missing: [...] }
 */
export async function requireCompleteProfile(req, client) {
  const result = await getProfileStatus(client, req.user.id, req.user.role);
  if (!result.ok) {
    throw httpError(403, 'profile_incomplete', 'profile incomplete', {
      missing: result.missing,
    });
  }
}
