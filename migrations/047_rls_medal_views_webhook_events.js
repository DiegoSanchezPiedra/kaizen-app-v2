// migrations/047_rls_medal_views_webhook_events.js
// B20 (auditoría de RLS, B6): medal_views (lo escriben y leen funciones SECURITY DEFINER) y webhook_events (el
// servicePool) eran las únicas tablas sin RLS, además de pgmigrations. Hoy app_user no tiene permisos en ellas; con RLS
// en ENABLE y FORCE sin políticas, un GRANT que se cuele no abre nada. service_role (BYPASSRLS) sigue igual.
/* eslint-disable camelcase */

export const shorthands = undefined;

const TABLES = ['medal_views', 'webhook_events'];

export const up = (pgm) => {
  pgm.sql(TABLES.map((t) => `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`)
    .join('\n'));
};

export const down = (pgm) => {
  pgm.sql(TABLES.map((t) => `ALTER TABLE ${t} NO FORCE ROW LEVEL SECURITY; ALTER TABLE ${t} DISABLE ROW LEVEL SECURITY;`)
    .join('\n'));
};
