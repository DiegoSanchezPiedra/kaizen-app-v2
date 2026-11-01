// migrations/025_password_resets.js
// B18.0: recuperar contraseña. app_user no toca password_resets: solo las dos funciones SECURITY DEFINER (owner
// service_role), que se llaman sin sesión; así el servicePool de login sigue siendo la única excepción.
// Se guarda solo el SHA-256 del token (lo calcula el backend); 1 h y un solo uso; pedir otro anula los anteriores.
/* eslint-disable camelcase */

export const shorthands = undefined;

const FNS = ['create_password_reset(text, text)', 'consume_password_reset(text, text)'];

export const up = (pgm) => {
  pgm.createTable('password_resets', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    profile_id: { type: 'uuid', notNull: true, references: 'profiles', onDelete: 'CASCADE' },
    token_hash: { type: 'text', notNull: true, unique: true },
    expires_at: { type: 'timestamptz', notNull: true },
    used_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('password_resets', 'profile_id');
  pgm.sql(`
    ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
    ALTER TABLE password_resets FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON password_resets FROM app_user;

    -- true si el email tiene credenciales (para decidir si se envía el email; la ruta responde 204 igual).
    CREATE FUNCTION create_password_reset(p_email text, p_token_hash text) RETURNS boolean
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE pid uuid;
      BEGIN
        SELECT profile_id INTO pid FROM auth_credentials WHERE email = p_email;
        IF NOT FOUND THEN RETURN false; END IF;
        UPDATE password_resets SET used_at = now() WHERE profile_id = pid AND used_at IS NULL;
        INSERT INTO password_resets (profile_id, token_hash, expires_at) VALUES (pid, p_token_hash, now() + interval '1 hour');
        RETURN true;
      END
      $$;

    -- false si el token no existe, caducó o ya se usó. Un perfil solo con Google gana así contraseña.
    CREATE FUNCTION consume_password_reset(p_token_hash text, p_password_hash text) RETURNS boolean
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE pid uuid;
      BEGIN
        UPDATE password_resets SET used_at = now()
         WHERE token_hash = p_token_hash AND used_at IS NULL AND expires_at > now()
        RETURNING profile_id INTO pid;
        IF pid IS NULL THEN RETURN false; END IF;
        UPDATE auth_credentials SET password_hash = p_password_hash WHERE profile_id = pid;
        RETURN true;
      END
      $$;
  `);
  for (const fn of FNS) {
    pgm.sql(`ALTER FUNCTION ${fn} OWNER TO service_role; REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;
             GRANT EXECUTE ON FUNCTION ${fn} TO app_user;`);
  }
};

export const down = (pgm) => {
  for (const fn of FNS) pgm.sql(`DROP FUNCTION ${fn};`);
  pgm.dropTable('password_resets');
};
