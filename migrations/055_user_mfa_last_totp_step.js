// migrations/055_user_mfa_last_totp_step.js
// B20: un código TOTP valía varias veces dentro de su ventana (90 s con window 1). last_totp_step guarda el último paso
// de 30 s usado (activar o entrar): uno de un paso igual o anterior ya no entra. NULL: ninguno (o secreto nuevo).
/* eslint-disable camelcase */

export const shorthands = undefined;

export const up = (pgm) => pgm.sql(`ALTER TABLE user_mfa ADD COLUMN last_totp_step bigint`);
export const down = (pgm) => pgm.sql(`ALTER TABLE user_mfa DROP COLUMN last_totp_step`);
