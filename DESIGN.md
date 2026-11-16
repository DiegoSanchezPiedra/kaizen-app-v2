---
name: Kaizen
description: "App de la academia de artes marciales Kaizen: azul noche, calma operativa y energía manga reservada a los logros."
colors:
  azul-kaizen: "#0B47F0"
  azul-kaizen-noche: "#2F62FF"
  cian-ki: "#0BB4F5"
  cian-ki-noche: "#22C3FF"
  naranja-poder: "#FF6A00"
  naranja-poder-noche: "#FF7A1A"
  tinta-noche: "#050A2E"
  tinta-texto: "#0A1033"
  fondo-papel: "#F6F7FB"
  superficie: "#FFFFFF"
  texto-apagado: "#4F5778"
  enlace-noche: "#7FA2FF"
  fondo-noche: "#060A1C"
  superficie-noche: "#0D1330"
  texto-noche: "#EDF0FF"
  texto-apagado-noche: "#A2A9CC"
  exito: "#10B981"
  exito-texto: "#047857"
  aviso: "#F59E0B"
  aviso-texto: "#B45309"
  error: "#EF4444"
  error-texto: "#B91C1C"
  informacion: "#0EA5E9"
  informacion-texto: "#0369A1"
typography:
  display:
    fontFamily: "Barlow Condensed, DM Sans Variable, ui-sans-serif, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: 1
  headline:
    fontFamily: "Barlow Condensed, DM Sans Variable, ui-sans-serif, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 700
  title:
    fontFamily: "DM Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
  body:
    fontFamily: "DM Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "DM Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.25
  numeral:
    fontFamily: "Geist Mono Variable, ui-monospace, monospace"
    fontSize: "0.9375rem"
    fontWeight: 400
    fontFeature: "\"tnum\""
  streak-numeral:
    fontFamily: "Barlow Condensed, DM Sans Variable, ui-sans-serif, sans-serif"
    fontSize: "3rem"
    fontWeight: 800
    lineHeight: 1
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  2xl: "18px"
spacing:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.azul-kaizen}"
    textColor: "#FFFFFF"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    height: "36px"
    padding: "0 11px"
  button-primary-hover:
    backgroundColor: "{colors.azul-kaizen}"
  button-outline:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.tinta-texto}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    height: "36px"
    padding: "0 11px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.tinta-texto}"
    rounded: "{rounded.lg}"
    height: "36px"
  badge-success:
    textColor: "{colors.exito-texto}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    height: "26px"
    padding: "0 5px"
  card:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.tinta-texto}"
    rounded: "{rounded.2xl}"
    padding: "16px"
  input:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.tinta-texto}"
    typography: "{typography.body}"
    height: "34px"
    padding: "0 11px"
  next-up:
    backgroundColor: "{colors.azul-kaizen}"
    textColor: "#FFFFFF"
    typography: "{typography.display}"
    rounded: "{rounded.2xl}"
    padding: "16px"
---

# Design System: Kaizen

## Overview

**Creative North Star: "El dojo en calma, con chispa"**

Kaizen es la aplicación diaria de una academia de artes marciales: se reserva una clase, se mira la cuota, se firma un documento, se ve la racha. La interfaz es serena y precisa, de azul noche sobre papel frío, con la tipografía condensada reservada a lo que merece titular (el título de pantalla, la hora de la próxima clase, las cifras). Lo cotidiano se lee de un vistazo; la emoción llega en los hitos.

La energía manga es la «chispa» y se gasta con cuentagotas: la viñeta de la racha, las medallas, el kanji 改, el aura que sube con el esfuerzo. Todo lo demás es tarjeta clara, borde fino y sombra mínima. Que la chispa sea rara es lo que la hace funcionar.

Se construye sobre coss ui (Base UI + Tailwind 4) con los valores del canvas «Kaizen · Sistema de diseño». Es móvil primero: el diseño base es el de 375 px y se amplía en `sm` y `lg`. Hay modo claro y oscuro, y los dos son de primera clase.

**Key Characteristics:**
- Tono sereno y preciso, con picos de energía en los logros.
- Azul noche y papel frío; el cian y el naranja son acentos de significado, no decoración.
- Una sola tipografía de titular (condensada) usada con parquedad; el resto en sans.
- Tarjetas casi planas con borde fino; sombra dura solo en racha y medallas.
- Componentes táctiles: objetivos de 44 px, escala al pulsar, foco con anillo.
- Cada estado lleva icono y texto, nunca solo color.

## Colors

Un azul eléctrico sobre fondos de tinta y papel, con un cian y un naranja que cargan significado de juego (ki y poder) y cuatro colores de estado.

### Primary
- **Azul Kaizen** (#0B47F0): la acción principal y el hueco principal del Inicio; enlaces en claro, anillo de foco y selección de navegación. En oscuro pasa a **Azul Kaizen Noche** (#2F62FF), que como texto no llega a 4,5:1: los enlaces en oscuro usan **Enlace Noche** (#7FA2FF).

### Secondary
- **Cian Ki** (#0BB4F5): el halo del logo, el aura de la racha y las medallas de constancia. En oscuro, #22C3FF. Su texto sobre claro usa #0369A1.

### Tertiary
- **Naranja Poder** (#FF6A00): el esfuerzo y la potencia; resplandor de las medallas de mayor nivel. En oscuro, #FF7A1A. Su texto sobre claro usa #B84D00.

### Neutral
- **Tinta Noche** (#050A2E): el panel de la racha y el azul de marca. Nunca como fondo de pantalla.
- **Tinta Texto** (#0A1033): texto principal en claro; es también la base de los bordes al 10 % y al 48 % (campos).
- **Fondo Papel** (#F6F7FB): fondo de pantalla en claro. **Superficie** (#FFFFFF): tarjetas y campos.
- **Texto Apagado** (#4F5778): texto secundario en claro (7:1 sobre superficie).
- **Fondo Noche** (#060A1C), **Superficie Noche** (#0D1330), **Texto Noche** (#EDF0FF) y **Texto Apagado Noche** (#A2A9CC): el modo oscuro.
- **Estado:** **Éxito** (#10B981, texto #047857), **Aviso** (#F59E0B, texto #B45309), **Error** (#EF4444, texto #B91C1C), **Información** (#0EA5E9, texto #0369A1). El relleno va a un 8 % de opacidad (16 % en oscuro) y el texto y el icono usan la variante `-texto`, que es la que cumple contraste.

### Named Rules
**The One Spark Rule.** El naranja y el cian de energía viven en racha, medallas y marca. No se usan como color de botón, de fondo de sección ni de énfasis en pantallas de gestión.

**The Contrast Floor Rule.** Texto a 4,5:1 y gráficos a 3:1, medidos, no estimados. El borde de un campo es el 48 % de la tinta (34 % en oscuro) porque necesita 3:1; el borde de una tarjeta es el 10 % porque es decoración.

## Typography

**Display Font:** Barlow Condensed (700, 800 y 800 cursiva), con DM Sans como respaldo
**Body Font:** DM Sans Variable (con `system-ui` de respaldo)
**Label/Mono Font:** Geist Mono Variable, solo para horas y datos tabulares

**Character:** una condensada pesada y cursiva que recuerda a un título de manga deportivo, frente a una sans geométrica y amable que hace de voz de la interfaz.

### Hierarchy
- **Display** (700, 2,25 rem, interlineado 1): la hora de la próxima clase («Hoy · 17:22») y otros números protagonistas.
- **Headline** (700, 1,625 rem): el título de cada pantalla.
- **Title** (600, 1,125 rem): títulos de sección en DM Sans, no en condensada.
- **Body** (400, 1 rem, 1,5): texto corrido y botones en móvil; 14 px en `sm` para botones. Medida de línea de 65–75 ch.
- **Label** (500, 0,875 rem): insignias, metadatos y texto secundario.
- **Numeral** (Geist Mono, 0,9375 rem, cifras tabulares): horas en las tarjetas de sesión.
- **Streak numeral** (800 cursiva, 3 rem y 4,5 rem en Progreso): solo el número de la racha.

### Named Rules
**The Display-On-Numbers Rule.** La condensada es para el título de pantalla, las horas y las cifras. Los títulos de sección, de tarjeta y de estado vacío van en sans semibold. (Recomendación.)

**The Tabular Rule.** Todo número que cambia (hora, cuenta atrás, racha, importes) usa cifras tabulares para que no salte el diseño.

## Layout

Móvil primero: una sola columna de 375 px con 16 px de margen lateral y 16 px entre bloques de una misma pantalla (20 px entre el título y el contenido; 12 px entre elementos de una lista). La navegación es una barra inferior fija de cinco pestañas (Inicio, Calendario, Reservas, Progreso, Cuenta) con área segura; desde `lg` pasa a barra lateral izquierda de 256 px.

El contenido es una columna estrecha centrada (`max-w-xl`, 576 px) hasta `lg`, donde las pantallas con dos zonas se reparten en rejilla de dos columnas (`max-w-5xl`, 1024 px): lo principal a la izquierda y lo secundario (pendientes, racha) en una columna de 21 rem a la derecha. Las pantallas de gestión usan siempre el ancho de escritorio. Los puntos de ruptura son los de Tailwind (`sm` 640 px, `lg` 1024 px).

El orden del HTML es el orden visual móvil, para que el Tab lo siga; la reordenación de escritorio se hace con la rejilla, no con `order`.

## Elevation & Depth

Híbrido contenido: superficie clara con borde fino de 1 px y una sombra casi invisible, más un reflejo interior de 1 px que da volumen sin peso. La profundidad fuerte se reserva para el hueco principal del Inicio y para los logros.

### Shadow Vocabulary
- **Tarjeta** (`box-shadow: 0 1px 2px rgb(0 0 0 / 0.05)` y reflejo `0 1px rgb(0 0 0 / 0.04)`; en oscuro `0 -1px rgb(255 255 255 / 0.06)`): contenedores y campos.
- **Botón principal** (`0 1px 2px` del color primario al 24 % y reflejo interior `0 1px rgb(255 255 255 / 0.16)`): se anula al pulsar o deshabilitar.
- **Hueco principal** (`0 1px 2px rgb(0 0 0 / 0.12), 0 10px 20px -10px` del primario al 75 %): una sola vez por pantalla.
- **Sombra dura de logro** (`4px 4px 0 #000`, y `3px 3px 0 #000` en el número): racha y medallas, con borde negro de 3 px.
- **Resplandor de poder** (`0 0 0 1px rgb(255 106 0 / 0.4), 0 10px 36px -6px rgb(255 106 0 / 0.55)`): medallas de mayor nivel.

### Named Rules
**The Soft-By-Default Rule.** Las superficies están casi planas en reposo. La sombra dura desplazada (sin desenfoque) es exclusiva de racha y medallas. (Recomendación.)

## Shapes

Esquinas suaves y consistentes derivadas de un único radio base de 10 px: 6 px en insignias, 8 px en controles pequeños, 10 px en botones y campos, 14 px en tarjetas pequeñas y 18 px en tarjetas y bloques principales. El radio interior es el exterior menos el relleno cuando hay elementos anidados. Los avatares son circulares. La viñeta de racha es la excepción: esquinas de 18 px con borde negro grueso y un número inclinado -3°, que es su firma.

## Components

Táctiles y seguros: todo elemento pulsable tiene al menos 44 px de área en táctil, responde al pulsar con una escala de 0,97 y muestra un anillo azul de 2 px al recibir foco por teclado.

### Buttons
- **Shape:** esquinas de 10 px (`rounded-lg`); altura de 36 px en móvil y 32 px desde `sm`; `lg` 40 px y `xl` 44 px.
- **Primary:** azul Kaizen con texto blanco, reflejo interior y sombra suave; sobre hover baja al 90 % de opacidad.
- **Outline:** superficie blanca con borde del 48 % de tinta (oscuro: relleno 32 %); es el botón de las tarjetas de aviso.
- **Ghost / Link / Secondary / Destructive:** transparente con fondo de acento al pasar; subrayado; relleno 5 %; rojo con reflejo.
- **Press / Focus:** `scale(0.97)` en 150 ms ease-out; anillo `--ring` de 2 px con separación de 1 px del fondo.

### Chips
- **Insignias de estado:** esquinas de 6 px, relleno al 8 % del color de estado y texto en su variante `-texto`. Llevan siempre icono y texto: Reservada, En espera, Cancelada, Celebrada.

### Cards / Containers
- **Corner Style:** 18 px (`rounded-2xl`).
- **Background:** superficie; en oscuro, Superficie Noche.
- **Shadow Strategy:** ver *Soft-By-Default*; borde de 1 px.
- **Internal Padding:** 16 px.

### Inputs / Fields
- **Style:** 34 px de alto (42 px en táctil), relleno 11 px, borde del 48 % de tinta, texto de marcador al 72 %.
- **Focus:** anillo de 2 px del color `--ring`.
- **Error / Disabled:** el error va en texto y en `aria-invalid`, nunca solo en color; deshabilitado al 64 % de opacidad.

### Navigation
- Barra inferior de cinco pestañas con icono y etiqueta; la activa lleva píldora de acento azul al 12 %. Desde `lg`, barra lateral de 256 px. El título de pantalla repite la pestaña activa y se mantiene.

### Hueco principal (NextUp)
Tarjeta azul de 18 px con la hora en display («Hoy · 17:22»), la disciplina en semibold y los datos en una línea con cuenta atrás. Es el elemento dominante del Inicio y se pulsa entero.

### Tarjeta de pendientes (HomeSteps)
Una tarjeta con título «Tienes N cosas pendientes» y una fila de 56 px como mínimo por aviso: icono de estado en su color, título, texto y chevrón. Una fila resuelta se pliega en 200 ms.

### Racha (StreakPanel)
La firma de la marca: viñeta de tinta noche con borde negro de 3 px, sombra dura, kanji 改 en una chapa y un número inclinado sobre un aura cuyo tamaño y paleta suben con la racha. Con racha 0 baja a una franja de tarjeta normal.

### Movimiento
Curvas: ease-out `cubic-bezier(0.23, 1, 0.32, 1)` para entradas y respuestas; ease-in-out `cubic-bezier(0.77, 0, 0.175, 1)` para movimiento en pantalla; `cubic-bezier(0.32, 0.72, 0, 1)` para hojas; `cubic-bezier(0.34, 1.36, 0.64, 1)` (con rebote) solo para logros. Duraciones: pulsación 150 ms, fundido de contenido 200 ms, entrada de bloque 320 ms con 60 ms entre bloques, logro 720 ms. La entrada escalonada se juega una sola vez por sesión de la app. Con `prefers-reduced-motion` no hay transformaciones y quedan solo fundidos.

## Do's and Don'ts

### Do:
- **Do** poner un único elemento dominante por pantalla y que lo accionable quede por encima del pliegue de 812 px en móvil.
- **Do** dar a cada estado icono y texto (Reservada, En espera, Cancelada) y usar la variante `-texto` del color para el texto y el icono.
- **Do** usar `--link` (#7FA2FF) para enlaces en modo oscuro: el azul primario no llega a 4,5:1 como texto sobre fondo oscuro.
- **Do** reservar naranja, cian y sombra dura para racha, medallas y marca.
- **Do** usar cifras tabulares en todo número que cambie.
- **Do** mantener el orden del HTML igual al visual y comprobar el orden de tabulación.
- **Do** respetar `prefers-reduced-motion` en todo movimiento nuevo y reutilizar `--ease-out`, `animate-rise` y `enter-soft` antes de crear otras animaciones.

### Don't:
- **Don't** animar a la vez todo el contenido en cada visita: la entrada escalonada es solo de la primera visita de la sesión.
- **Don't** (recomendación) usar la sombra dura desplazada fuera de racha y medallas.
- **Don't** (recomendación) poner un borde de color de más de 1 px en un solo lado de una tarjeta, fila o aviso.
- **Don't** (recomendación) usar la tipografía condensada en títulos de sección ni en estados vacíos.
