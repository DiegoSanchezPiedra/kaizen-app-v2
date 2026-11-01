# Kaizen · frontend

PWA de alumno, tutor, profesor y tablet (B18). React + Vite + TypeScript + Tailwind CSS v4 + coss ui
(ADR 0013). El sistema de diseño está en `src/index.css` (tokens de coss ui con los valores de Kaizen) y viene del
canvas «Kaizen · Sistema de diseño».

## Arrancar en local

Con la base de datos levantada (`docker compose up -d`) y el `.env` de la raíz:

```bash
npm run dev            # API en http://127.0.0.1:3000 (raíz del repo)
npm run dev:frontend   # PWA en http://localhost:5173 (raíz del repo)
```

Vite reenvía `/api/*` a la API quitando el prefijo, igual que Nginx en producción. Para el botón de Google, copia
`.env.example` a `.env.local` con el mismo `GOOGLE_CLIENT_ID` del backend y añade `http://localhost:5173` a los
orígenes autorizados del cliente OAuth en Google Cloud.

## Comprobar

```bash
npm test               # Vitest (lógica pura: fechas, sesión, rutas, errores)
npx tsc -b             # tipos
npm run lint           # oxlint
```

## Producción

`npm run build:frontend` desde la raíz (`ci` + `build`, reproducible) deja `frontend/dist`, que sirve
`deploy/nginx.conf` con la CSP, `Referrer-Policy` y `Cache-Control: no-store` en `/api/`.

## Reglas

- Componentes de coss ui en `src/components/ui` (se añaden con `npx shadcn@latest add @coss/<nombre>`). Cambios
  propios ahí: campos de 44 px en táctil (`input.tsx`) y escala 0,97 al pulsar (`button.tsx`).
- Textos de error por `code` en `src/lib/errors.ts`; el `message` de la API nunca se enseña.
- Fechas y horas siempre de Madrid e importes en euros: `src/lib/format.ts`.
- Nada de `dangerouslySetInnerHTML` ni de scripts inline (CSP). Los datos de la API no se guardan en el
  dispositivo (ADR 0015): solo el token.
