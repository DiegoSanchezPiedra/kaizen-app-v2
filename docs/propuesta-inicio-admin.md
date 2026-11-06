# Propuesta: Inicio del admin (`/admin`)

> 2026-11-06. Pendiente de aprobar. Se escribió sin ver el Inicio de MAAT (en la web no hay capturas de su panel), así que la
> parte «como MAAT» está por cotejar: ver § 7. Hecha con impeccable (shape, modo *Operate*), taste-skill, emil-design-eng y
> make-interfaces-feel-better. Móvil primero, a 375 px. Sustituye a `docs/pantallas-b19.md` § Inicio cuando se apruebe.

## 1. Qué falla hoy

`frontend/src/pages/admin/home.tsx` tiene tres bloques: cuatro cifras, «Requiere atención» y «Hoy».

- **Las cifras son de ayer.** Salen de la foto de cada noche (`academy_stats_daily`). Si un alumno paga a las 10:00, el Inicio
  no lo enseña hasta mañana. Sin ejecutar el job nocturno, las cifras se quedan vacías («Aún no hay fotos»).
- **No dice qué pasa ahora en el tatami.** «Hoy» enseña las sesiones con su fase (programada, en curso, celebrada), pero no
  cuánta gente ha reservado ni cuánta ha entrado.
- **Las cuatro cifras son de dinero o de cuotas** (activas, en gracia, impagadas, MRR), y tres de ellas se solapan con
  «Requiere atención». Faltan las de personas: alumnos activos, alumnos que han dejado de venir y asistencia.
- **No hay accesos directos** para lo que el admin hace en el mostrador: buscar a un alumno, pasar lista de la sesión que
  está en marcha, crear una sesión suelta o un evento.
- **La pantalla no se refresca sola:** solo al volver a ella o al cambiar de pestaña.

## 2. A quién sirve y para qué

El admin (el dueño o quien está en recepción) abre el Inicio muchas veces al día, casi siempre en el móvil y entre clases.
En unos segundos tiene que saber tres cosas: **qué pasa ahora**, **si algo pide que actúe** y **cómo va la academia**. Cada
dato lleva a la pantalla donde se arregla. Es una pantalla de trabajo (*Operate*): manda leerla de un vistazo, no el adorno.

## 3. La propuesta, de arriba abajo

```
375 px
┌─────────────────────────────────┐
│ Inicio           ● En vivo · 18:42│  fecha larga debajo: «jueves, 6 de noviembre»
│ [🔍 Buscar alumno…            ]  │  → /admin/users?q=
├─────────────────────────────────┤
│ AHORA · BJJ adultos  18:30–20:00│  la sesión en curso; si no hay, la próxima
│ Hugo (profesor) · Tatami 1      │
│ 12 dentro · 18 reservas · 24 pl.│
│ ▓▓▓▓▓▓▓▓▓▓░░░░░░  (meter)       │
│ [ Pasar lista ]   Ver sesión ›  │
├─────────────────────────────────┤
│ ┌─────────────┐┌─────────────┐  │  cuatro cifras en vivo (2 × 2)
│ │Alumnos act. ││Impago       │  │  la línea de 30 días es la tendencia
│ │ 142  +6     ││ 3           │  │  de las fotos; el número, el de ahora
│ │ ╱╲_╱‾‾      ││ (rojo si >0)│  │
│ ├─────────────┤├─────────────┤  │
│ │Ingreso/mes  ││Asist. hoy   │  │
│ │ 6.840 €     ││ 37  ↑ 12 %  │  │  vs. el mismo día de la semana pasada
│ └─────────────┘└─────────────┘  │
├─────────────────────────────────┤
│ Requiere atención               │  solo lo que es > 0
│ (3) Impagados              ›    │
│ (9) Sin venir hace 14 días ›    │
│ (1) Entregas fallidas      ›    │
├─────────────────────────────────┤
│ Hoy                    Horario ›│
│ 07:00 Funcional  8/12  ✓ cerr. ›│  reservas / aforo, y entradas
│ 18:30 BJJ        18/24 ● ahora ›│
│ 20:00 Muay thai  10/20         ›│
├─────────────────────────────────┤
│ Próximos eventos      Eventos › │  7 días; inscritos / aforo
├─────────────────────────────────┤
│ Hoy en la academia              │  altas, bajas, cobros fallidos de hoy
│ · Ana López se ha dado de alta  │  (de la auditoría, ya existe)
├─────────────────────────────────┤
│ [+ Sesión suelta] [+ Evento]    │  accesos directos
└─────────────────────────────────┘
```

En `lg`: las cuatro cifras en una fila arriba; debajo, a la izquierda (8 columnas) «Ahora» y «Hoy», y a la derecha (4)
«Requiere atención», «Próximos eventos» y «Hoy en la academia». El buscador y los accesos directos van en la cabecera.

### Bloque a bloque

1. **Cabecera.** «Inicio», la fecha y un indicador «En vivo · hh:mm» con la hora del último dato. Si falla la red, cambia a
   «Sin conexión · hh:mm» en ámbar, con texto y no solo con color. Debajo, el **buscador de alumno**: al pulsar Intro va a
   Usuarios con `?q=`. No busca mientras se escribe (eso ya lo hace Usuarios).
2. **Ahora** (el foco de la pantalla, y lo que ningún panel genérico tiene). La sesión en curso con disciplina, hora, profesor
   y lugar, y un medidor de **dentro / reservas / aforo**. La acción principal es **Pasar lista**, que lleva al detalle de la
   sesión. Sin sesión en curso, enseña la próxima («Siguiente: Muay thai a las 20:00»). Sin más sesiones hoy: la primera de
   mañana. Con dos sesiones a la vez, las dos, una debajo de otra.
3. **Cuatro cifras en vivo**, cada una enlazada a su pantalla:
   - **Alumnos activos** (de `GET /admin/profiles/stats`, ya en vivo desde B22.3) → Usuarios `?estado=activo`. Al lado, la
     diferencia con hace 30 días (de la foto).
   - **Impago** (el mismo endpoint) → Cobros › Morosos. En rojo si es mayor que 0.
   - **Ingreso recurrente al mes** (el MRR de ahora: la misma función de la foto, `academy_stats_of`, con el día de hoy)
     → Informes.
   - **Asistencias de hoy** frente al mismo día de la semana pasada → Informes › Alumnos.
   - La **línea de 30 días** sigue saliendo de las fotos de cada noche. Es la tendencia; el número grande es el de ahora.
     Así el job nocturno solo hace falta para el histórico.
   - Las cifras de dinero de hoy («en periodo de gracia», «impagadas») pasan a «Requiere atención», que es donde se actúa.
4. **Requiere atención.** Lo de ahora (morosos, en gracia, cambios de pagador caducados, entregas fallidas y avisos) y dos
   nuevos: **sin venir hace 14 días** (`inactivos` de las estadísticas → Usuarios `?estado=inactivo`) y **perfiles sin
   completar** (sin ficha médica o sin firmar documentos), si el servidor lo puede contar sin un endpoint nuevo; si no, se
   deja fuera. Solo salen las filas mayores que 0. Con todo a 0, «Nada pendiente».
5. **Hoy.** Las sesiones de hoy con **reservas / aforo** y, en las que ya han empezado, cuánta gente ha entrado. Las
   canceladas, tachadas y en gris. Enlace «Horario ›» a la semana.
6. **Próximos eventos** (7 días): título, día, inscritos / aforo. Solo si hay alguno.
7. **Hoy en la academia**: las últimas 5 altas, bajas, cobros fallidos y cancelaciones de sesión de hoy, de `GET /admin/audit`
   con prefijos de acción. Cada fila, a su ficha. Sin nada hoy, el bloque no sale.
8. **Accesos directos**: «Sesión suelta» y «Evento» (abren la hoja de crear de su pantalla). Son pocos a propósito: más de dos
   o tres botones acaban sin leerse.

## 4. Tiempo real

- **Polling, no WebSockets.** Las consultas de «Ahora», «Hoy» y las cifras se repiten cada 30 s con `refetchInterval` de
  TanStack Query, solo con la pestaña visible (es lo que hace por defecto), y al volver a la app. SSE ya existe para la tablet,
  pero aquí no compensa: a nadie le cambia nada que una entrada aparezca a los 30 s en vez de al momento.
- **Un endpoint nuevo, `GET /admin/home`**, para no hacer 8 peticiones cada 30 s. Devuelve:
  - las cifras de ahora: `academy_stats_of(hoy)`, más `activos`, `impago` e `inactivos` de `getProfileStats`;
  - las asistencias de hoy y del mismo día de la semana pasada;
  - las sesiones de hoy con `booked` y `present`.

  Con el client RLS del admin. `academy_stats_of` hoy solo la puede llamar el job (`service_role`). Además es
  `SECURITY DEFINER` y no comprueba el rol, así que darle `EXECUTE` a `app_user` tal cual dejaría que cualquier alumno viera
  las cifras de la academia. Hay dos opciones:

  - una migración pequeña que añada una comprobación de admin a la función antes de darle el permiso (recomendada: una sola
    regla para la foto y para el Inicio);
  - repetir su `SELECT` en el servicio, que la RLS del admin ya deja leer.

  Con su test, que incluya que un alumno recibe 403.
- Lo que cambia poco (eventos, auditoría, atención) se refresca al abrir y cada 2 min.

## 5. Detalle y movimiento

- **Sin animaciones de entrada.** El admin abre esta pantalla decenas de veces al día (emil: lo frecuente no se anima). Nada
  de contadores que suben desde 0 ni tarjetas que aparecen en cascada.
- **Al cambiar una cifra**, el número cambia sin moverse (`tabular-nums`) y su tarjeta hace un fundido de fondo de 150 ms
  como mucho. Nada con `prefers-reduced-motion`.
- **El punto de «En vivo»** no late: un punto fijo verde. Un latido constante cansa en una pantalla de trabajo.
- **Al pulsar**, tarjetas y filas responden con `scale(0.98)` y `:active`, igual que las filas de B22. Hit areas de 44 px
  como mínimo.
- **Esqueletos con la forma final** de cada bloque, para que nada salte al cargar. Cada bloque falla por separado, con su
  «Reintentar»: si se cae la auditoría, el resto se sigue viendo.
- Radios concéntricos entre el marco y la tarjeta, como en B22. Los mismos tokens y colores que ahora: es un ajuste dentro
  del sistema de B18 y B22, no un estilo nuevo.

## 6. Fuera de esta propuesta

Gráficas grandes (están en Informes), un tablero que se pueda personalizar, objetivos o metas, datos de salud o edad (las
reglas del panel no los permiten) y notificaciones push al admin.

## 7. Qué falta para cerrarla

1. **Capturas del Inicio de MAAT** (móvil y escritorio, si las tienes) para cotejar qué cifras y accesos tiene y qué
   echarías de menos. Con ellas ajusto §§ 3–4 antes de implementar.
2. Aprobación, o cambios, de los bloques de § 3 y del endpoint de § 4.
3. Después, la implementación como un bloque del plan, con backend y frontend juntos: el endpoint con su test, la pantalla,
   la comprobación a 375 px y el despliegue en staging.
