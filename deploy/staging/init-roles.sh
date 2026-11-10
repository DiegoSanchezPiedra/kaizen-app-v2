#!/bin/sh
# Primer arranque de la BD de staging: los tres roles de db-architecture.md y la base, con sus contraseñas del entorno.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE migrator LOGIN PASSWORD '$MIGRATOR_PASSWORD';
CREATE ROLE app_user LOGIN PASSWORD '$APP_PASSWORD';
CREATE ROLE service_role LOGIN BYPASSRLS PASSWORD '$SERVICE_PASSWORD';
-- Las migraciones crean funciones SECURITY DEFINER y vistas con dueño service_role: migrator tiene que poder asumirlo.
GRANT service_role TO migrator;
CREATE DATABASE ${DB_NAME:-kaizen_staging} OWNER migrator;
SQL
# service_role crea objetos en public (ALTER … OWNER TO service_role en las migraciones) y app_user solo los usa.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "${DB_NAME:-kaizen_staging}" <<SQL
GRANT USAGE, CREATE ON SCHEMA public TO migrator, service_role;
GRANT USAGE ON SCHEMA public TO app_user;
SQL
# Privilegios por defecto de lo que cree migrator (iguales a los de la base local): las migraciones los usan con SET ROLE.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "${DB_NAME:-kaizen_staging}" <<SQL
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
SQL
