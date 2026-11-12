// migrations/061_minor_access.js
// B32: acceso propio del menor (ADR 0026, sustituye al 0002). Un tutor vinculado da a su hijo, de cualquier edad, un
// usuario y una contraseña; lo revoca cuando quiera. Con su acceso el menor es actor y sujeto de lo suyo, con límites:
// - auth_credentials: username (único, en minúsculas y sin forma de email) y email opcional (nulo para el menor; desde
//   los 14 lo puede poner su tutor). can_book: el permiso de reservar (por defecto sí). El tutor lee la fila del hijo.
// - Funciones del tutor (SECURITY DEFINER): grant/update/revoke_minor_access. Revocar borra las credenciales y sus
//   dispositivos de push; la activación y cada cambio dejan un aviso en audit_log (el de la activación es el registro
//   del consentimiento: quién, cuándo, IP y versión del texto informativo) que reciben los demás tutores.
// - El menor como actor (actor_is_minor()): no lee su salud, sus cobros, su suscripción ni sus firmas; no cambia su nombre
//   visible ni (por debajo de 14) su visibilidad pública; no reserva ni se inscribe sin el permiso de reservar; no paga
//   eventos ni cambia de disciplina (minor_restricted); no restablece su contraseña por email.
// - Perfil público de un menor: lo decide su tutor (y él desde los 14), con o sin acceso; antes, nunca.
// - Avisos operativos de reservas y eventos: también al menor con acceso (notice_recipients), salvo los de cobertura,
//   pausa y cambio de disciplina, que siguen solo a sus tutores.
// - Reclamar a los 18 con acceso: profile_missing pide su email y que confirme la ficha que rellenó su tutor.
// - minor_consent_age(): la edad de consentimiento (hoy 14, art. 7 LOPDGDD) en un solo sitio; si la ley la sube, se
//   cambia aquí. La usan el email del menor, su visibilidad pública y sus redes (y requireAuth, para can_publish).
// - Con app_user, nada responde por otro perfil: in_pause e is_minor pasan a internas (visible_in_pause y
//   actor_is_minor para la API); write_audit no deja a un menor anotar cambios de suscripción.
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const ROLE = `current_setting('app.current_role', true)`;
const IS_ADMIN = `COALESCE(${ROLE} = 'admin', false)`;
const UID_004 = `(current_setting('app.current_user_id', true))::uuid`;
const UID_003 = `current_setting('app.current_user_id', true)::uuid`;
const MINOR_ACTOR = 'actor_is_minor()';
const UNDER_CONSENT = (birth) => `${birth} > CURRENT_DATE - make_interval(years => minor_consent_age())`;

// Parches sobre la definición actual (como 060): [función, texto de antes, texto de después]. Si no encuentra, falla.
const PATCHES = [
  ['booking_notice(uuid, text, jsonb)', `COALESCE((SELECT array_agg(g.tutor_id) FROM guardianships g WHERE g.minor_id = b.student_id),
${' '.repeat(24)}ARRAY[b.student_id])`, `notice_recipients(b.student_id, p_action)`],
  ['event_notice(uuid, text, uuid, jsonb)', `COALESCE((SELECT array_agg(g.tutor_id) FROM guardianships g WHERE g.minor_id = r.profile_id),
${' '.repeat(28)}ARRAY[r.profile_id])`, `notice_recipients(r.profile_id, p_action)`],
  ['register_event(uuid, uuid, boolean)', `INSERT INTO event_registrations (event_id, profile_id, actor_id, payer_id, status, amount_cents, guest)`,
    `IF amt > 0 AND ${MINOR_ACTOR} THEN RAISE EXCEPTION 'minor_restricted' USING ERRCODE = '42501'; END IF;
        INSERT INTO event_registrations (event_id, profile_id, actor_id, payer_id, status, amount_cents, guest)`],
  ['change_discipline(uuid, bigint, bigint, uuid)', `SELECT * INTO s FROM subscriptions WHERE id = p_subscription FOR UPDATE;`,
    `IF is_minor(p_actor) THEN RAISE EXCEPTION 'minor_restricted' USING ERRCODE = '42501'; END IF;
        SELECT * INTO s FROM subscriptions WHERE id = p_subscription FOR UPDATE;`],
  ['create_password_reset(text, text)', `SELECT profile_id INTO pid FROM auth_credentials WHERE email = p_email;`,
    `SELECT profile_id INTO pid FROM auth_credentials WHERE email = p_email AND NOT is_minor(profile_id);`],
  ['profiles_update_guard()', `IF OLD.id IS DISTINCT FROM ${UID} THEN`,
    `IF OLD.id = ${UID} AND actor_is_minor()
           AND (NEW.display_name IS DISTINCT FROM OLD.display_name
                OR ((NEW.is_public, NEW.visible_fields, NEW.social_links)
                      IS DISTINCT FROM (OLD.is_public, OLD.visible_fields, OLD.social_links)
                    AND ${UNDER_CONSENT('OLD.birth_date')})) THEN
          RAISE EXCEPTION 'minor_restricted' USING ERRCODE = '42501';
        END IF;
        IF OLD.id IS DISTINCT FROM ${UID} THEN`],
  ['profiles_update_guard()',
    `IF (NEW.bio, NEW.social_links, NEW.visible_fields) IS DISTINCT FROM (OLD.bio, OLD.social_links, OLD.visible_fields)`,
    `IF NEW.bio IS DISTINCT FROM OLD.bio
             OR ((NEW.social_links, NEW.visible_fields) IS DISTINCT FROM (OLD.social_links, OLD.visible_fields) AND NOT guardian)`],
  ['profiles_update_guard()', `OR (COALESCE(NEW.is_public, false) AND NOT COALESCE(OLD.is_public, false))`,
    `OR (COALESCE(NEW.is_public, false) AND NOT COALESCE(OLD.is_public, false) AND NOT guardian)`],
  ['write_audit(uuid, text, text, text, jsonb)', `uid IS NULL OR p_actor IS DISTINCT FROM uid`,
    `uid IS NULL OR p_actor IS DISTINCT FROM uid OR (is_minor(uid) AND p_action LIKE 'subscription.%')`],
  ['visible_discipline_changes_used(uuid)', `(s.student_id = ${UID} OR s.payer_id`,
    `((s.student_id = ${UID} AND NOT is_minor(${UID})) OR s.payer_id`],
];
const patch = ([fn, from, to]) => `
  DO $do$
  DECLARE
    def text := pg_get_functiondef('${fn}'::regprocedure);
  BEGIN
    IF position($q$${from}$q$ IN def) = 0 THEN RAISE EXCEPTION '${fn}: no encuentro %', $q$${from}$q$; END IF;
    EXECUTE replace(def, $q$${from}$q$, $q$${to}$q$);
  END
  $do$;
`;

// Funciones que se reescriben enteras: [firma, cuerpo de 061, cuerpo de antes].
const BOOKING_CAN_ACT = [`booking_can_act(p_student uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public`,
  `SELECT ${UID} IS NOT NULL AND ${ROLE} <> 'profesor'
           AND (${IS_ADMIN} OR p_student = ${UID} OR is_guardian_of(p_student))
           AND NOT (${MINOR_ACTOR} AND NOT EXISTS (SELECT 1 FROM auth_credentials WHERE profile_id = ${UID} AND can_book))`,
  `SELECT ${UID} IS NOT NULL AND ${ROLE} <> 'profesor'
           AND (${IS_ADMIN} OR p_student = ${UID} OR is_guardian_of(p_student))`];
const CAN_BE_PUBLIC = [`can_be_public(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public`,
  `SELECT EXISTS (SELECT 1 FROM profiles p JOIN user_roles r ON r.user_id = p.id
                      WHERE ${UID} IS NOT NULL AND p.id = p_id AND (p.id = ${UID} OR p.is_public OR is_guardian_of(p.id))
                        AND r.role IN ('alumno', 'profesor')
                        AND (is_minor(p.id) OR EXISTS (SELECT 1 FROM auth_credentials a WHERE a.profile_id = p.id)))`,
  `SELECT EXISTS (SELECT 1 FROM profiles p JOIN user_roles r ON r.user_id = p.id
                      WHERE NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL AND p.id = p_id AND (p.id = ${UID} OR p.is_public) AND r.role IN ('alumno', 'profesor') AND (p.birth_date IS NULL OR p.birth_date <= CURRENT_DATE - interval '18 years')
  AND EXISTS (SELECT 1 FROM auth_credentials a WHERE a.profile_id = p.id))`];
const PROFILE_MISSING = [`profile_missing(p_id uuid) RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public`,
  `SELECT array_remove(ARRAY[
          CASE WHEN COALESCE(trim(p.display_name), '') = '' THEN 'display_name' END,
          -- B32: al cumplir 18, la ficha que rellenó su tutor la confirma él (guardándola).
          CASE WHEN h.profile_id IS NULL OR (NOT is_minor(p.id) AND h.updated_at < p.birth_date + interval '18 years')
               THEN 'health_info'
               WHEN COALESCE(h.emergency_contact_name, '') = '' OR COALESCE(h.emergency_contact_phone, '') = ''
               THEN 'emergency_contact' END,
          CASE WHEN NOT signed_current(p.id, 'data_protection') THEN 'data_protection' END,
          CASE WHEN NOT signed_current(p.id, 'rights_of_image') THEN 'rights_of_image' END,
          -- B32: el adulto que entra con el usuario que le dio su tutor añade su email.
          CASE WHEN c.profile_id IS NOT NULL AND c.email IS NULL AND NOT is_minor(p.id) THEN 'email' END
        ], NULL)
          FROM profiles p LEFT JOIN student_health_info h ON h.profile_id = p.id
          LEFT JOIN auth_credentials c ON c.profile_id = p.id
         WHERE p.id = p_id`,
  `SELECT array_remove(ARRAY[
          CASE WHEN COALESCE(trim(p.display_name), '') = '' THEN 'display_name' END,
          CASE WHEN h.profile_id IS NULL THEN 'health_info'
               WHEN COALESCE(h.emergency_contact_name, '') = '' OR COALESCE(h.emergency_contact_phone, '') = ''
               THEN 'emergency_contact' END,
          CASE WHEN NOT signed_current(p.id, 'data_protection') THEN 'data_protection' END,
          CASE WHEN NOT signed_current(p.id, 'rights_of_image') THEN 'rights_of_image' END
        ], NULL)
          FROM profiles p LEFT JOIN student_health_info h ON h.profile_id = p.id
         WHERE p.id = p_id`];
const replaceFn = ([sig, body]) => `CREATE OR REPLACE FUNCTION ${sig} AS $$
        ${body}
      $$;`;

// Políticas que distinguen sujeto y actor: el sujeto que lee lo suyo deja de valer si es un menor (actor).
const policies = (minor) => {
  const self = (expr) => (minor ? `(${expr} AND NOT ${MINOR_ACTOR})` : expr);
  return `
    ALTER POLICY student_health_info_select ON student_health_info
      USING (${self(`profile_id = ${UID_003}`)} OR (${ROLE} = 'admin') OR is_guardian_of(profile_id));
    ALTER POLICY student_health_info_insert_self ON student_health_info
      WITH CHECK (${self(`profile_id = ${UID_003}`)} OR is_guardian_of(profile_id));
    ALTER POLICY student_health_info_update_self_or_admin ON student_health_info
      USING (${self(`profile_id = ${UID_003}`)} OR (${ROLE} = 'admin') OR is_guardian_of(profile_id))
      WITH CHECK (${self(`profile_id = ${UID_003}`)} OR (${ROLE} = 'admin') OR is_guardian_of(profile_id));
    ALTER POLICY student_health_info_delete_self_or_admin ON student_health_info
      USING (${self(`profile_id = ${UID_003}`)} OR (${ROLE} = 'admin'));
    ALTER POLICY invoices_select ON invoices
      USING (${self(`student_id = ${UID}`)} OR is_guardian_of(student_id, true) OR payer_id = ${UID} OR ${IS_ADMIN});
    ALTER POLICY subscriptions_select ON subscriptions
      USING (${self(`student_id = ${UID}`)} OR is_guardian_of(student_id, true) OR payer_id = ${UID} OR ${IS_ADMIN});
    ALTER POLICY user_agreements_select ON user_agreements
      USING (${self(`profile_id = ${UID_004}`)} OR signed_by = ${UID_004} OR ${ROLE} = 'admin' OR is_guardian_of(profile_id));
    ALTER POLICY profiles_update_guardian ON profiles
      WITH CHECK (is_guardian_of(id, true) AND birth_date > CURRENT_DATE - interval '18 years'${minor ? '' : ' AND is_public = false'});`;
};

const own = (sig, app = true) => `
    ALTER FUNCTION ${sig} OWNER TO service_role;
    REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;
    ${app ? `GRANT EXECUTE ON FUNCTION ${sig} TO app_user;` : ''}`;

const NOTICES = `('notice.minor_access_granted', 'notice.minor_access_revoked', 'notice.minor_access_changed',
                        'notice.minor_avatar_changed')`;
const GUARDIAN = `IF ${UID} IS NULL OR ${MINOR_ACTOR} OR NOT is_guardian_of(p_minor) THEN
          RAISE EXCEPTION 'not_guardian' USING ERRCODE = '42501';
        END IF;`;

export const up = (pgm) => {
  pgm.sql(`
    CREATE FUNCTION is_minor(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT COALESCE((SELECT birth_date > CURRENT_DATE - interval '18 years' FROM profiles WHERE id = p_id), false)
    $$;
    ${own('is_minor(uuid)', false)}
    CREATE FUNCTION actor_is_minor() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT is_minor(${UID})
    $$;
    ${own('actor_is_minor()')}
    -- Edad de consentimiento (art. 7 LOPDGDD): hoy 14; si la ley la sube a 16, se cambia solo aquí.
    CREATE FUNCTION minor_consent_age() RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 14 $$;
    ${own('minor_consent_age()')}

    -- in_pause es interna (la usan las reservas y la racha de cualquiera); la API pregunta solo por quien puede ver.
    REVOKE EXECUTE ON FUNCTION in_pause(uuid, timestamptz) FROM app_user;
    CREATE FUNCTION visible_in_pause(p_student uuid, p_at timestamptz) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT CASE WHEN p_student = ${UID} OR is_guardian_of(p_student, true) OR ${IS_ADMIN} THEN in_pause(p_student, p_at) END
    $$;
    ${own('visible_in_pause(uuid, timestamptz)')}

    ALTER TABLE auth_credentials
      ALTER COLUMN email DROP NOT NULL,
      ADD COLUMN username text CONSTRAINT auth_credentials_username_format CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,29}$'),
      ADD COLUMN can_book boolean NOT NULL DEFAULT true,
      ADD CONSTRAINT auth_credentials_identity_check CHECK (email IS NOT NULL OR username IS NOT NULL);
    CREATE UNIQUE INDEX auth_credentials_username_key ON auth_credentials (username);
    GRANT SELECT (username, can_book) ON auth_credentials TO app_user;
    CREATE POLICY auth_credentials_select_guardian ON auth_credentials FOR SELECT TO app_user
      USING (is_guardian_of(profile_id));

    -- Destinatarios de un aviso operativo del alumno: sus tutores y él si tiene acceso propio (si no tiene tutores, él).
    CREATE FUNCTION notice_recipients(p_student uuid, p_action text) RETURNS uuid[]
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT COALESCE(NULLIF(ARRAY(
        SELECT g.tutor_id FROM guardianships g WHERE g.minor_id = p_student
        UNION
        SELECT p_student WHERE EXISTS (SELECT 1 FROM auth_credentials c WHERE c.profile_id = p_student)
          AND NOT (is_minor(p_student) AND p_action IN ('notice.no_coverage', 'notice.pause', 'notice.discipline_change'))
      ), '{}'), ARRAY[p_student])
    $$;
    ${own('notice_recipients(uuid, text)', false)}

    -- Aviso del acceso del menor a sus tutores (salvo a quien lo hace). La fila de audit_log es también el registro.
    CREATE FUNCTION minor_notice(p_minor uuid, p_action text, p_extra jsonb) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        aid uuid := gen_random_uuid();
        rcpts uuid[] := ARRAY(SELECT tutor_id FROM guardianships WHERE minor_id = p_minor);
      BEGIN
        IF p_action NOT IN ${NOTICES} THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
        INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
        VALUES (aid, ${UID}, p_action, 'profile', p_minor::text, COALESCE(p_extra, '{}') || jsonb_build_object(
          'profile_name', (SELECT display_name FROM profiles WHERE id = p_minor),
          'actor_name', (SELECT display_name FROM profiles WHERE id = ${UID}), 'recipients', to_jsonb(rcpts)));
        PERFORM enqueue_notice(aid, rcpts, ${UID});
      END
    $$;
    ${own('minor_notice(uuid, text, jsonb)', false)}

    CREATE FUNCTION grant_minor_access(p_minor uuid, p_username text, p_password_hash text, p_email text, p_ip inet,
                                       p_notice_version text) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      BEGIN
        ${GUARDIAN}
        IF p_email IS NOT NULL AND ${UNDER_CONSENT('(SELECT birth_date FROM profiles WHERE id = p_minor)')} THEN
          RAISE EXCEPTION 'email_requires_14' USING ERRCODE = '22023';
        END IF;
        -- credentials_changed_at: un token de un acceso anterior (revocado) no vuelve a valer.
        INSERT INTO auth_credentials (profile_id, username, password_hash, email, credentials_changed_at)
        VALUES (p_minor, p_username, p_password_hash, p_email, date_trunc('second', now()));
        PERFORM minor_notice(p_minor, 'notice.minor_access_granted',
          jsonb_build_object('username', p_username, 'ip', p_ip, 'notice_version', p_notice_version));
      END
    $$;
    ${own('grant_minor_access(uuid, text, text, text, inet, text)')}

    -- NULL = no cambia; p_set_email distingue «quitar el email» de «no tocarlo». Cambiar la contraseña cierra sus sesiones.
    CREATE FUNCTION update_minor_access(p_minor uuid, p_password_hash text, p_set_email boolean, p_email text,
                                        p_can_book boolean) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE fields text[] := '{}';
      BEGIN
        ${GUARDIAN}
        IF p_set_email AND p_email IS NOT NULL
           AND ${UNDER_CONSENT('(SELECT birth_date FROM profiles WHERE id = p_minor)')} THEN
          RAISE EXCEPTION 'email_requires_14' USING ERRCODE = '22023';
        END IF;
        UPDATE auth_credentials SET
          password_hash = COALESCE(p_password_hash, password_hash),
          credentials_changed_at = CASE WHEN p_password_hash IS NULL THEN credentials_changed_at
                                        ELSE date_trunc('second', now()) END,
          email = CASE WHEN p_set_email THEN p_email ELSE email END,
          can_book = COALESCE(p_can_book, can_book)
         WHERE profile_id = p_minor;
        IF NOT FOUND THEN RAISE EXCEPTION 'access_not_found' USING ERRCODE = 'P0002'; END IF;
        IF p_password_hash IS NOT NULL THEN fields := fields || 'password'::text; END IF;
        IF p_set_email THEN fields := fields || 'email'::text; END IF;
        IF p_can_book IS NOT NULL THEN fields := fields || 'can_book'::text; END IF;
        PERFORM minor_notice(p_minor, 'notice.minor_access_changed',
          jsonb_build_object('fields', to_jsonb(fields), 'can_book', p_can_book));
      END
    $$;
    ${own('update_minor_access(uuid, text, boolean, text, boolean)')}

    -- Sin credenciales, requireAuth rechaza al momento cualquier token del hijo. Sus dispositivos dejan de recibir avisos.
    CREATE FUNCTION revoke_minor_access(p_minor uuid) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      BEGIN
        ${GUARDIAN}
        DELETE FROM auth_credentials WHERE profile_id = p_minor;
        IF NOT FOUND THEN RAISE EXCEPTION 'access_not_found' USING ERRCODE = 'P0002'; END IF;
        DELETE FROM push_subscriptions WHERE profile_id = p_minor;
        PERFORM minor_notice(p_minor, 'notice.minor_access_revoked', '{}');
      END
    $$;
    ${own('revoke_minor_access(uuid)')}

    -- El menor cambia su foto ('avatar') o su contraseña ('password'): aviso a sus tutores. Para cualquier otro, nada.
    CREATE FUNCTION minor_self_notice(p_kind text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      BEGIN
        IF NOT ${MINOR_ACTOR} THEN RETURN; END IF;
        IF p_kind = 'avatar' THEN PERFORM minor_notice(${UID}, 'notice.minor_avatar_changed', '{}');
        ELSIF p_kind = 'password' THEN
          PERFORM minor_notice(${UID}, 'notice.minor_access_changed', '{"fields": ["own_password"]}');
        ELSE RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
        END IF;
      END
    $$;
    ${own('minor_self_notice(text)')}

    -- Reclamar a los 18: el adulto que entra con su usuario añade su email una vez (app_user no escribe el email).
    CREATE FUNCTION set_own_email(p_email text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      BEGIN
        IF ${UID} IS NULL OR ${MINOR_ACTOR} THEN RAISE EXCEPTION 'minor_restricted' USING ERRCODE = '42501'; END IF;
        UPDATE auth_credentials SET email = p_email WHERE profile_id = ${UID} AND email IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'email_already_set'; END IF;
      END
    $$;
    ${own('set_own_email(text)')}

    ${replaceFn(BOOKING_CAN_ACT)}
    ${replaceFn(CAN_BE_PUBLIC)}
    ${replaceFn(PROFILE_MISSING)}
    ${policies(true)}
  `);
  PATCHES.forEach((p) => pgm.sql(patch(p)));
};

export const down = (pgm) => {
  [...PATCHES].reverse().forEach(([fn, from, to]) => pgm.sql(patch([fn, to, from])));
  pgm.sql(`
    ${policies(false)}
    ${replaceFn([PROFILE_MISSING[0], PROFILE_MISSING[2]])}
    ${replaceFn([CAN_BE_PUBLIC[0], CAN_BE_PUBLIC[2]])}
    ${replaceFn([BOOKING_CAN_ACT[0], BOOKING_CAN_ACT[2]])}
    DROP FUNCTION set_own_email(text);
    DROP FUNCTION minor_self_notice(text);
    DROP FUNCTION revoke_minor_access(uuid);
    DROP FUNCTION update_minor_access(uuid, text, boolean, text, boolean);
    DROP FUNCTION grant_minor_access(uuid, text, text, text, inet, text);
    DROP FUNCTION minor_notice(uuid, text, jsonb);
    DROP FUNCTION notice_recipients(uuid, text);
    DROP POLICY auth_credentials_select_guardian ON auth_credentials;
    -- shortcut: bajar borra el acceso de los menores (y de quien solo tenga usuario); no hay a dónde llevarlo.
    DELETE FROM auth_credentials WHERE email IS NULL;
    ALTER TABLE auth_credentials DROP CONSTRAINT auth_credentials_identity_check, DROP COLUMN can_book, DROP COLUMN username,
      ALTER COLUMN email SET NOT NULL;
    DROP FUNCTION visible_in_pause(uuid, timestamptz);
    GRANT EXECUTE ON FUNCTION in_pause(uuid, timestamptz) TO app_user;
    DROP FUNCTION minor_consent_age();
    DROP FUNCTION actor_is_minor();
    DROP FUNCTION is_minor(uuid);
  `);
};
