// src/lib/roles.js — varios roles por cuenta (ADR 0033). Prioridad: admin > profesor > tutor > alumno; es el orden de
// `roles` y el rol con el que se entra si no hay último rol usado.
// El front los muestra en otro orden, el de presentación (ROLE_ORDER en frontend/src/lib/admin.ts).
export const ROLES = ['admin', 'profesor', 'tutor', 'alumno'];

// Los roles de un perfil (`uid`: expresión SQL del id) como text[] por prioridad; vacío si no tiene ninguno.
export const rolesSql = (uid) => `COALESCE((SELECT array_agg(r.role::text ORDER BY CASE r.role
    WHEN 'admin' THEN 0 WHEN 'profesor' THEN 1 WHEN 'tutor' THEN 2 ELSE 3 END)
  FROM user_roles r WHERE r.user_id = ${uid}), '{}')`;
