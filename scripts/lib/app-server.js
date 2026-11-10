// B20: la app entera (src/app.js) escuchando en un puerto libre dentro del proceso del test. Se para con close(), nunca
// con pkill: no toca otros servidores. Sin el worker de avisos (eso lo arranca src/index.js).
import { once } from 'node:events';
import app from '../../src/app.js';

export async function startApp() {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const http = async (method, url, { token, body } = {}) => {
    const headers = { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) };
    const res = await fetch(base + url, { method, headers, body: body && JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return { http, close: () => new Promise((resolve) => server.close(resolve)) };
}
