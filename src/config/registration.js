// src/config/registration.js — registro público abierto o cerrado (ADR 0032). En producción nace cerrado: la beta es por
// invitación del admin. REGISTRATION_OPEN=true/false lo fuerza. Es una función y no una constante para que los tests lo cambien.
export const registrationOpen = () =>
  process.env.REGISTRATION_OPEN ? process.env.REGISTRATION_OPEN === 'true' : process.env.NODE_ENV !== 'production';
