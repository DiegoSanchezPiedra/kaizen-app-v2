Quiero mejorar el diseño y el movimiento de: `/tablet`. Código principal: `pages/tablet.tsx`, `lib/tablet.ts`, `hooks/use-tablet-feed.ts`.

Modo: Quiosco: pantalla fija y grande, mirada a distancia. Aquí cabe más presencia visual, pero la chispa manga sigue reservada a los logros. Sin nombres de alumnos, que es una regla de privacidad.

Contexto de este grupo:
- Muestra el QR de check-in y el estado de las sesiones, SIN nombres de alumnos (privacidad): no lo cambies.
- Se autentica con un token de dispositivo y se actualiza por sondeo: cubre cargando, sin conexión, token inválido y sin sesiones.
- Legibilidad a distancia: tipografía grande, contraste alto, sin interacciones finas ni objetivos pequeños. Pregúntame en el grilling si debe ir en oscuro o en claro, y en qué tamaño de pantalla se usa.

Cautelas de este grupo:
- No registres un dispositivo nuevo ni toques tokens reales; simula el feed con `page.route`.

Punto de partida:
- Crea la rama `feat/tablet` desde `feat/home-alumno` (ahí están NextUp, HomeSteps, useStepRows, la utilidad animate-rise y DESIGN.md). Commitea solo tus ficheros: en el árbol puede haber cambios míos sin confirmar que no son de esto (mira `git status` antes y no los toques).
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
