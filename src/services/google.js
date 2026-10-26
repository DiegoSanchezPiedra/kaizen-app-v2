// src/services/google.js
import { OAuth2Client } from 'google-auth-library';
import { GOOGLE_CLIENT_ID } from '../config/auth.js';

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

export async function verifyGoogleIdToken(idToken) {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload?.email) {
    throw Object.assign(new Error('ID token de Google sin sub/email'), { status: 401 });
  }
  return {
    sub: payload.sub,
    email: payload.email,
    emailVerified: Boolean(payload.email_verified),
  };
}