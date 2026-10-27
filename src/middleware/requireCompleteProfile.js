// src/middleware/requireCompleteProfile.js
import { requireCompleteProfile as checkProfileComplete } from '../services/profile.js';
import { httpError } from '../lib/errors.js';

/**
 * Middleware que bloquea la petición si el alumno no tiene el perfil
 * completo (health info + 3 agreements en versión vigente + display_name).
 *
 * Requiere que `requireAuth` haya corrido antes (deja req.user = { id, role }).
 *
 * Respuesta si falta algo:
 *   403 { error: 'forbidden', code: 'profile_incomplete', missing: [...] }
 *
 * Uso (B7, B10):
 *   router.post('/bookings',
 *     requireAuth,
 *     requireCompleteProfile,
 *     asyncHandler(createBookingHandler),
 *   );
 */
export async function requireCompleteProfile(req, res, next) {
  try {
    if (!req.user || !req.user.id || !req.user.role) {
      throw httpError(500, 'rls_context_missing', 'user context missing');
    }

    const result = await checkProfileComplete(req.user.id, req.user.role);

    if (!result.ok) {
      throw httpError(403, 'profile_incomplete', 'profile incomplete', {
        missing: result.missing,
      });
    }

    return next();
  } catch (err) {
    return next(err);
  }
}