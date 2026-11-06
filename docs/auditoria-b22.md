# Auditoría de la PWA y dirección visual (B22.0)

> 2026-11-06, Opus alto. `plan-de-bloques.md` § B22 y `docs/pantallas-b22.md`. **Aprobada** por el usuario el
> 2026-11-06, con las cuatro decisiones de § 5 tal como se recomiendan. Solo se cambian las pantallas de B22 y lo
> compartido; el resto de hallazgos queda en § 6 (pendientes).

## Cómo se hizo

- **impeccable** (`audit`): detector estático sobre `frontend/src` y revisión del código (tokens, `ui/table.tsx`,
  shell del admin, Calendario, Horario, Clases, Catálogo, Usuarios, profesor).
- **A 375 px** (iframe de 375 × 812 en Chrome contra la API local): 13 rutas del alumno, 5 del tutor y 15 del admin, en
  oscuro y una en claro. En cada una se midió el scroll horizontal, los elementos que se salen, los campos de menos de
  16 px, los textos de menos de 12 px y las zonas táctiles.
- **taste-skill**: es un kit para webs de empresa (reparto de paletas, heroes, fotos y efectos), y la paleta de B18 está
  cerrada, así que no se aplicó ese reparto. Se tomaron sus reglas de «un sistema» (un estilo de pestaña, de tarjeta y de
  enlace; una acción principal por pantalla; dos cajas de profundidad como máximo) y la de densidad del modo Operate.
- **Sin comprobar**: el profesor renderizado (la cuenta `prof.b184@seed.test` no tiene la contraseña de prueba; se
  revisó el código), el gesto táctil real (Chrome de escritorio, `pointer: fine`), el iPhone y el escritorio de las
  pantallas del admin.

## 1. Puntuación

| # | Dimensión | Nota | Hallazgo clave |
|---|---|---|---|
| 1 | Accesibilidad | 3 | AA en tokens (texto secundario 6,6–8,5:1, enlaces 6,2–7,4:1, borde de campo 3:1), campos a 16 px, foco visible, iconos con `aria-label`. Faltan zonas táctiles en enlaces de texto sin `text-link` |
| 2 | Rendimiento | 3 | 22 rutas en carga diferida; `index` de unos 440 KB sin comprimir. Nada que corregir en B22 |
| 3 | Temas | 3 | Tokens completos y oscuro bien resuelto. Hay colores fijos solo en superficies de marca, en la tablet y en las series de Informes del profesor |
| 4 | Adaptable | 2 | Ninguna página tiene scroll horizontal, pero Calendario y Horario apilan los 7 días y las tablas convertidas en tarjetas genéricas son largas o se rompen (Clases) |
| 5 | Integridad | 3 | Sistema coherente y propio; deriva en tres estilos de pestaña y en la tarjeta genérica frente a las listas hechas a mano |
| **Total** | | **14/20** | **Bien**: corregir Adaptable |

**Veredicto de integridad: pasa.** La app tiene un sistema propio y coherente: Barlow Condensed en los títulos, el panel
azul noche de la racha, el naranja «power» solo para la racha y los badges, tokens de coss ui con los valores de B18 y el
modo oscuro cuidado. El detector solo encuentra `--ease-power` (rebote) en `index.css:79`, que es la animación de la
racha de B18 y es intencionado: falso positivo. La deriva real está en cómo se resuelven las listas en móvil, no en la
marca.

## 2. Hallazgos por gravedad

### P1

**[P1] Calendario del alumno y del tutor: hoy queda a 3.500 px** · Adaptable · `pages/calendar.tsx:170`
En móvil se apilan los 7 días con todas sus sesiones (el documento mide 3.480 px el alumno y 3.533 px el tutor). El
viernes 6, hoy, sale tras cuatro pantallas de sesiones ya «Celebradas». Es el uso principal de la app y el motivo de
B22.1. → **B22.1** (tira de días con solo el día elegido).

**[P1] Clases en móvil: la tarjeta genérica se rompe** · Adaptable · `pages/admin/classes.tsx:78-123`
`Table` pasa cada fila a «etiqueta: valor» por debajo de `sm`. En Clases sale una tarjeta de unos 240 px por clase con
9 filas, el día repetido en cada tarjeta, «18:00» y «· 60 min» separados a los dos extremos, y la disciplina y el profesor
partidos en dos líneas (`max-w-36 truncate` dentro de un `flex`). Los botones «Cambiar» y «Retirar» quedan flotando.
→ **B22.1b** (composición en § 4).

### P2

**[P2] Horario del admin apila la semana** · Adaptable · `pages/admin/sessions.tsx:131`
La lista ya es densa y es la mejor de la app (hora, plazas, estado, disciplina, profesor y lugar en unos 68 px), pero el
documento mide 2.890 px. → **B22.1**.

**[P2] Profesor: días sin semana** · Adaptable · `pages/professor.tsx:145`
Es una lista de días sin flechas ni «Hoy» (revisado solo en el código). → **B22.1** (deja su lista de días por la tira).

**[P2] Usuarios: 4.500 px de tarjetas genéricas** · Adaptable · `pages/admin/users.tsx:118`
Cada persona ocupa unos 120 px con «Email / Rol / Cuota / Alta» repetidos; la página mide 4.539 px. Las etiquetas se leen
una vez y después estorban. → **B22.3** (tarjeta por persona, § 4).

**[P2] Catálogo: tarjetas genéricas y «Editar» suelto** · Adaptable · `pages/admin/catalog.tsx:90,195`
Funciona, pero «Quién / Reserva / Estado» en filas y el botón solo en la esquina dan unos 135 px por disciplina.
→ **B22.2** (Membresías y Disciplinas, § 4).

**[P2] Tres estilos de pestaña** · Integridad · `components/ui/tabs.tsx`, `ui/segmented-control.tsx`,
`components/section-tabs.tsx`
`ui/tabs` (seleccionada rellena en gris) en Calendario, Catálogo, Usuarios, Cobros, Avisos e Informes;
`SegmentedControl` en Reservas e Informes del profesor; `SectionTabs` (seleccionada con borde) en Progreso y Comunidad.
En la misma barra inferior, Calendario y Progreso se ven distintos. → **Decisión 3** (§ 5).

### P3

**[P3] Enlaces de texto sin zona táctil** · Accesibilidad · `pages/calendar.tsx:190` («Ver mis reservas», 18 px de
alto), y fuera de alcance en Avisos («Ver el evento», «Ver la ficha», 20 px) y Auditoría (nombres, 19 px).
La regla táctil de `index.css` solo agranda `a.text-link`, y estos no llevan la clase. → En **B22.1**, `text-link` en el
del Calendario; los demás, a § 6.

## 3. Patrones

- **La tarjeta genérica de `Table` es una red de seguridad, no un diseño.** Evita el scroll horizontal en todas las
  tablas (bien), pero en las pantallas de uso diario (Clases, Usuarios, Catálogo) triplica la altura. Las pantallas de
  B22 llevan su tarjeta propia y la genérica se queda para las de consulta (Auditoría, Tablets, Avisos, Cobros).
- **Ya existe la fila buena: la de Horario.** Hora en columna fija y `tabular-nums`, nombre en negrita, metadatos en gris
  y estado a la derecha. Es el patrón que se repite en Calendario, profesor, Horario y Clases (§ 4).
- **Las semanas apiladas son el mismo problema en tres sitios** (alumno y tutor, profesor, Horario): un componente lo
  resuelve, como ya decidió el plan.

## 4. Dirección visual (dentro de B18)

Modo **Operate**: la marca vive en los detalles, no en la composición. No se añaden colores, fuentes ni radios; tokens
nuevos solo si hacen falta para la tira y como alias de los existentes.

### Fila de sesión (canónica)

- Columna de hora de ancho fijo (`tabular-nums`, inicio en negrita y fin en gris debajo, como hoy en el Calendario),
  nombre en negrita, una línea gris «Profesor · Lugar», y a la derecha un solo estado (`Tag`) o la acción del rol.
- Altura mínima de 56 px y relleno de 12–16 px; separadas por borde dentro de un marco por día (como Horario), en vez de
  una tarjeta suelta por sesión. Así se queda en dos cajas de profundidad como máximo.
- **El motivo que se repite se dice una vez.** Hoy cada sesión no cubierta repite «Tu cuota no incluye esta
  disciplina». Propuesta: la etiqueta «No cubierta» en la fila y el motivo una sola vez encima de la lista del día.
  (Decisión 4.)

### Tira de días (B22.1)

- 7 botones de 44 × 52 px como mínimo en una rejilla de 7 columnas a todo el ancho (a 375 px, unos 47 px cada uno): la
  inicial del día pequeña en gris y el número en Barlow Condensed.
- **Elegido**: relleno `primary`. **Hoy**, si no es el elegido: anillo de 1,5 px `primary`. **Con clases**: punto de 4 px
  bajo el número (`muted-foreground`; `primary-foreground` en el elegido). **Pasados**: el número en `muted-foreground`
  sin opacidad (7:1, sigue legible).
- Encima, una línea con «‹  2 – 8 nov  ›» y «Hoy» como `variant="link"` cuando no se está en la semana actual, igual
  que Horario hoy.
- **Fija bajo la cabecera en móvil** (`sticky`), para cambiar de día sin volver arriba. (Decisión 1.)
- Deslizar: `touch-action: pan-y` en la tira, para que el gesto horizontal no robe el scroll vertical.
- Debajo, el título del día con el estilo de grupo actual («VIERNES, 6 DE NOVIEMBRE · HOY») y sus filas.
- **`lg`**: la tira encima de las 7 columnas; el día pulsado se resalta con `bg-accent` y un anillo, y hace scroll
  hasta su columna.
- Movimiento (lo detalla emil-design-eng): desplazamiento de 8–12 px y opacidad, 180 ms `--ease-out`; nada con
  `prefers-reduced-motion` (la regla global ya lo reduce).

### Clases en móvil (B22.1b)

- Agrupadas por día con el mismo título de grupo y el marco por día de Horario.
- Fila: «18:00 · 60 min» en la columna de hora; disciplina en negrita; «Profesor · Lugar» en gris; «10 plazas» a la
  derecha. Segunda línea gris con la vigencia: «Desde 31 oct» o «31 oct – 15 dic», y el `Tag` «Se retira» o «Retirada».
  Las retiradas, con el texto en gris como hoy.
- Acciones: un botón «⋯» de 44 px con menú (`ui/menu`): Cambiar y Retirar. (Decisión 2.)
- Unos 72 px por clase frente a los 240 de ahora.

### Usuarios (B22.3)

- **KPIs**: las tres tarjetas caben a 375 px en una rejilla de 3 columnas (unos 108 px cada una): cifra en Barlow
  Condensed grande con `tabular-nums` y la etiqueta debajo («Activos», «Impago», «Inactivos · 14 d»). Scroll dentro de
  su marco solo por debajo de unos 340 px. La seleccionada lleva anillo `primary` y `aria-pressed`. La de Impago con la
  cifra en `destructive-foreground` solo si es mayor que 0.
- **Tarjeta por persona**: nombre en negrita y `Tag` de estado a la derecha; debajo, «Rol · Plan» en gris y «Última
  asistencia hace 3 días». Sin etiquetas «Email/Rol». Toda la fila abre la ficha, sin botón aparte. Unos 64 px por
  persona.
- **Filtros**: búsqueda a todo el ancho; disciplina, plan y estado en una fila de `Select` compactos que pasa a dos
  líneas si no cabe, nunca con scroll de página.

### Membresías y Disciplinas (B22.2)

- Tarjeta propia en vez de la genérica: nombre en negrita y `Tag` de estado (Activa) a la derecha; debajo, en gris, lo
  que hoy son columnas («Todos · se elige en la cuota» o el precio y las disciplinas del plan). Toda la tarjeta abre la
  hoja de editar.
- Un solo botón principal por pantalla («Nueva membresía», «Nueva disciplina») en la cabecera, junto al título, como
  Clases y Horario hoy.

## 5. Decisiones (aprobadas el 2026-11-06)

1. **La tira de días va fija bajo la cabecera en móvil** (`sticky`).
2. **Acciones de Clases en móvil**: menú «⋯» de 44 px (Cambiar, Retirar).
3. **Pestañas**: en **B22.1** se unifica `ui/tabs` con el aspecto de `SectionTabs`. Cambia el componente compartido, y
   con él Calendario, Catálogo, Usuarios, Cobros, Avisos e Informes; `SegmentedControl` (Reservas, Informes del
   profesor) se alinea igual si el cambio es solo de estilo.
4. **El motivo de «No cubierta» sale una vez por día**, encima de la lista, y no en cada sesión.

## 6. Pendientes fuera de alcance

- **Informes del admin**: la gráfica desborda su marco (349/343 px) y las barras son zonas de toque de 7 px de ancho.
- **Cobros**: la tabla se desplaza dentro de su marco (401/343 px); lo permite la regla de B19, pero es la única.
- **Avisos y Auditoría**: enlaces de texto sin `text-link`, de 19–20 px de alto.
- **Auditoría**: 4.581 px de tarjetas genéricas.
- **Tablet y series de Informes del profesor**: colores fijos que duplican tokens (`#A2A9CC`, `#34D399`, `#0B47F0`…).
- **Tarjetas genéricas** en Avisos, Tablets y Documentos: correctas; se revisan si se rediseñan esas pantallas.

## 7. Lo que funciona y se conserva

- Ninguna de las 33 rutas medidas tiene scroll horizontal de página; todos los campos están a 16 px.
- Contraste AA con margen en ambos temas, y `--link` aparte de `--primary` en oscuro.
- Botones con zona táctil de 44 px en `pointer: coarse` (`ui/button`) y la regla de `a.text-link`.
- `prefers-reduced-motion` que no lo apaga todo: conserva las transiciones de color y opacidad.
- La fila de Horario, el panel de la racha y los estados vacíos (icono, título, texto y una acción), que son consistentes
  en toda la app.
