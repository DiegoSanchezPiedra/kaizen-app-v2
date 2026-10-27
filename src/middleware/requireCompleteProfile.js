// src/middleware/requireCompleteProfile.js
import { assertGuardianOf, getProfileStatus } from '../services/profile.js';
import { httpError } from '../lib/errors.js';

/**
 * Guard de `withRlsContext`: bloquea si el sujeto no tiene el perfil completo
 * (health info + 3 agreements en versión vigente + display_name) reutilizando
 * el `client` de la transacción.
 *
 * Sujeto = `body.profile_id` (hijo) o el propio usuario. Si actúa un tutor por
 * un hijo, deben estar completos el hijo y el tutor (D15).
 *
 * Uso (B7, B10):
 *   router.post('/bookings', requireAuth,
 *     withRlsContext(handler, { guards: [requireCompleteProfile] }));
 *
 * Falla con 403 { error: 'forbidden', code: 'profile_incomplete', missing: [...] }
 */
export async function requireCompleteProfile(req, client) {
  const subject = req.body?.profile_id ?? req.user.id;
  if (subject !== req.user.id) {
    await assertGuardianOf(client, subject);
    assertComplete(await getProfileStatus(client, subject, 'alumno'));
  }
  assertComplete(await getProfileStatus(client, req.user.id, req.user.role));
}

function assertComplete(result) {
  if (!result.ok) {
    throw httpError(403, 'profile_incomplete', 'profile incomplete', {
      missing: result.missing,
    });
  }
}
