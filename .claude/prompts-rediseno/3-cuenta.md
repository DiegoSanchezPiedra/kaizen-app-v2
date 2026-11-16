Quiero mejorar el diseño y el movimiento de las pantallas del grupo «Cuenta (9 pantallas)»: `/account`, `/account/data`, `/account/password`, `/account/profile`, `/account/children`, `/account/children/new` y `/account/children/:id`, `/account/health`, `/agreements`. Código principal: `pages/account.tsx`, `account-profile.tsx`, `children.tsx` y `components/health-form.tsx`, `agreements-panel.tsx`, `avatar-editor.tsx`, `child-access.tsx`, `my-data-form.tsx`.

Alcance de esta sesión: UNA pantalla (o subgrupo) cada vez. Empieza por: <ELIGE UNA DE LA LISTA DE ABAJO>. Al terminarla, commit y push, y para: te diré la siguiente.

Modo: Operate, formularios y ajustes. Aplican las reglas de DESIGN.md; el «elemento dominante» suele ser el formulario o el estado de la cuenta.

Pantallas del grupo (elige con cuál empiezas; lo que se anota aquí es contexto, no una limitación):
- Cuenta (/account): Menú de ajustes y entrada a todo lo demás.
- Mis datos (/account/data): Datos personales (`my-data-form.tsx`).
- Contraseña (/account/password): Cambio de contraseña (`password-input.tsx`).
- Perfil público (/account/profile): Avatar (`avatar-editor.tsx`) y qué se ve en rankings.
- Hijos (/account/children, /account/children/new, /account/children/:id): Listado, alta y edición. Crear hijos exige el permiso `can_create_children` (lo da el admin): el 403 se muestra en el formulario, no solo en un toast. Acceso propio del menor (`child-access.tsx`).
- Ficha de salud (/account/health): Datos de salud: máxima sensibilidad.
- Acuerdos (/agreements): Firma de protección de datos y derechos de imagen (`agreements-panel.tsx`): acción legal, con confirmación.

Contexto de este grupo:
- Trabaja UNA pantalla por sesión y por rama. Cuando termines una, commit y push, y para.
- Datos de salud: la UI nunca los muestra donde no toca, no se cachean y las acciones destructivas llevan `ConfirmDialog`.
- Formularios accesibles: `label`/`htmlFor`, errores con `aria-describedby`, foco al primer error, teclado móvil correcto.
- Con un hijo seleccionado, los textos nombran al hijo («Completa el perfil de Lara»); respétalo.

Cautelas de este grupo:
- No lances `alta-hijo` (registra un adulto nuevo y crea datos). Simula respuestas con `page.route`.

Punto de partida:
- Crea la rama `feat/<pantalla>` desde `feat/home-alumno` (ahí están NextUp, HomeSteps, useStepRows, la utilidad animate-rise y DESIGN.md). Commitea solo tus ficheros: en el árbol puede haber cambios míos sin confirmar que no son de esto (mira `git status` antes y no los toques).
- La fuente de verdad visual es `DESIGN.md` (raíz) y `.impeccable/design.json`. Respétalos; no los regeneres ni ejecutes `/impeccable document`. Las reglas marcadas «(recomendación)» se pueden discutir; el resto no. Si la pantalla exige romper una, dímelo antes.
- Lee las reglas de UI de la app antes de diseñar: `docs/pantallas-b18.md` (alumno y profesor) y `docs/pantallas-b19.md` y `b22.md` (panel admin): solo español, nunca salud/edad en la UI, móvil primero.

Reglas de trabajo:
- Antes de buscar o leer código, ejecuta `graphify query "<pregunta>"`. Lee ficheros crudos solo en las líneas que el grafo o una lectura previa ya hayan localizado.
- Mobile first: el diseño base es el móvil. Verifica primero a 375 px y luego en sm y lg.
- Reutiliza `src/components/ui` y los componentes existentes. No añadas librerías de componentes ni Radix/shadcn.
- No instales `motion`. Usa CSS, `tw-animate-css` y `data-starting-style`/`data-ending-style` de Base UI. Si hay un caso que no se pueda resolver así, dímelo antes de instalar nada.
- Reutiliza lo del Inicio antes de inventar: `NextUp`, `HomeSteps`, `useStepRows`, `animate-rise` (entrada escalonada, solo en la primera visita de la sesión), `enter-soft`, `--ease-out` y `StreakPanel compact`.
- Si cambia un componente compartido, añade props opcionales y verifica con Playwright que las demás pantallas que lo usan quedan iguales.
- El HTML va en el orden visual móvil (el Tab lo sigue). El reordenado de escritorio, con la rejilla, no con `order`.

Cómo trabajar (dos fases; el repo tiene la skill `orquestacion` y los agentes `Explore` e `implementer`):

FASE 1 — Diseño. La haces tú como líder, en modo plan, sin delegar y sin tocar código:
1. `mattpocock-skills:grilling`: preguntas sobre objetivo y estados de la pantalla antes de decidir nada.
2. `impeccable:impeccable` (critique): jerarquía, espaciado, tipografía y color, contra DESIGN.md. Para ver el código usa `Explore`.
3. Cierra con un plan por tareas (ficheros, qué cambia en cada uno, comando de aceptación, cuáles van en paralelo) y presenta el plan con ExitPlanMode. Espera mi visto bueno a la dirección y al plan.

FASE 2 — Ejecución, solo después de aprobar el plan. Carga la skill `orquestacion` y delega:
1. Primero, antes de tocar código: un `implementer` saca las capturas «antes». Tú las miras y confirmas que la dirección del plan sigue valiendo; si no, para y pregúntame.
2. `implementer`: implementa con `emil-design-eng` y `make-interfaces-feel-better`; luego el movimiento con `ecc:motion-foundations` y `ecc:motion-patterns` (solo duraciones, curvas y patrones; respeta `prefers-reduced-motion`); luego `ecc:frontend-a11y` (contraste medido con canvas, no estimado; foco visible; objetivos de al menos 44 px; etiquetas; orden de tabulación igual al visual).
3. `implementer`: verificación con un script de Playwright por Bash (no con el MCP) a 375 px y en escritorio, claro y oscuro, y el movimiento a cámara lenta. Añade o actualiza un e2e en `frontend/e2e`. Entrega una sola captura por pantalla y estado clave que junte «antes | después» lado a lado, recortada al área que cambia (compónlas en una página HTML temporal y captúrala). Si cambia un componente compartido, compara las demás pantallas con el comparador de capturas de Playwright, si está disponible, y devuelve solo el % de diferencia.
4. Tú revisas, sin fiarte del resumen del agente (un «listo» no cuenta):
   - Código: ejecutas tú `git diff`, `npx tsc -b`, `npm run lint` y `npm test`.
   - Evidencia, números primero: exige al `implementer` tablas pequeñas —ratio de contraste por cada par de colores con el script que usó; tamaño de los objetivos; para el movimiento, el muestreo de `requestAnimationFrame` (opacidad y transform por fotograma) frente a la curva prevista— y las rutas de las capturas. Sin esa evidencia, la tarea no está terminada.
   - Visual: abre tú las capturas compuestas «antes | después» (una por pantalla y estado clave) y, en las regresiones, solo las pantallas con diferencia en el pixel-diff; repite tú la medición de contraste en 2 o 3 puntos clave (texto principal, texto secundario y mensaje de error, en claro y oscuro) y comprueba tú la tabla del movimiento. Si el contexto se está llenando, avísame antes de seguir.
   - Si algo falla, devuélvelo con el fallo exacto (máximo 2 rondas); si sigue mal, avísame.

Reparto:
- Cada encargo a un `implementer` lleva copiadas íntegras las secciones «Reglas de trabajo» y «Cómo verificar sin publicar en staging», las cautelas del grupo y la rama: los agentes no ven esta conversación.
- Antes de delegar, levantas tú Vite (puerto 5174) y el reenvío 3000→3100 una sola vez, guardas los PID y los cierras al final. Esto sustituye lo que «Cómo verificar» dice sobre arrancarlos: los agentes los reutilizan y no arrancan los suyos. Otras tareas van en paralelo solo si tocan ficheros distintos.
- Los commits y el push los haces tú al final, solo con los ficheros de esta tarea. Los agentes no commitean.

Cómo verificar sin publicar en staging:
- NUNCA `npm run build` (publica en staging). Tipos con `npx tsc -b`; lint con `npm run lint`; tests con `npm test`.
- Para ver tu código: en `frontend/`, `npx vite --port 5174 --strictPort` en segundo plano. Su proxy apunta al puerto 3000 y la API de staging está en el 3100: pon un reenvío TCP temporal 3000→3100 (no toques vite.config.ts). Cuenta de prueba: la del tutor de staging de mis notas (memoria).
- Playwright MCP solo escribe dentro del repo: guarda capturas en `.playwright-mcp/<pantalla>/antes|despues/` (está ignorada por git). Saca las capturas «antes» ANTES de tocar nada.
- Datos: simula las respuestas con `page.route`. No escribas en la base de datos ni lances los e2e que crean hijos, registran adultos o firman (`alta-hijo`, `contratar-cuota`).
- La cámara lenta de CDP no ralentiza los `setTimeout`: si hay temporizadores, mide a velocidad real con un muestreo de `requestAnimationFrame`.
- Para cerrar Vite y el reenvío usa los PID guardados; `pkill -f` con el patrón en el mismo comando se mata a sí mismo.
- Los hooks piden, antes del primer Write o Edit de un fichero, decir quién lo usa y citar mi instrucción: dilo en el mensaje y reintenta.

Entrega: resumen corto de lo cambiado, capturas antes y después, lista de lo que has dejado sin hacer y riesgos. Al terminar: `graphify update .`, tipos, lint y tests, y commit y push a tu rama solo con tus ficheros. No abras PR hasta que yo lo diga.
