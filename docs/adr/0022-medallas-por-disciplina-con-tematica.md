# Las medallas son de cada disciplina y su aspecto lo da la temática de la disciplina

Decisión del 2026-11-09, en el diseño de B25 (migraciones 036 y 037).

- **Una escalera por disciplina.** Las 11 medallas (primera sesión, 10–1000 h y racha de 4–52 semanas) dejan de ser de
  toda la academia: cada disciplina en que el alumno ha estado presente tiene las suyas, contando solo su asistencia. Su
  racha se salta las semanas en que esa disciplina no dio clase. La racha general (Inicio y Progreso) no cambia.
- **Temática por disciplina.** El admin vincula cada disciplina a una temática del repertorio (`medal_themes`) o a
  ninguna (la neutra Kaizen). Una temática está en una sola disciplina activa a la vez (índice único parcial
  `disciplines_medal_theme_active`, 409 `theme_taken`); desactivar la disciplina la libera y la desactivada la conserva.
- **El repertorio vive en la BD y el arte en el código.** La tabla guarda el código y el nombre; los nombres de las
  medallas, la forma, la paleta y el kanji están en `frontend/src/lib/themes/<código>.ts`. Añadir un anime es un archivo
  y una fila. Una temática sin arte no se ofrece y se ve como Kaizen. Los códigos son internos y estables: al pasar a
  nombres de género antes de producción solo cambian el nombre y el arte.
- **Lo visto y el ranking, por disciplina.** `medal_views.codes` guarda `<discipline_id>:<código>` (la 037 vació los vistos
  globales: vuelven a la ventana de 14 días) y el ranking de medallas es por disciplina.

## Considered Options

- **11 medallas globales y la temática solo como aspecto**: ¿de qué disciplina sería la temática de una medalla global? No
  hay respuesta buena con varias disciplinas.
- **Repertorio cerrado en el código con un `CHECK` en la BD**: igual de pequeño, pero no lista temáticas libres en SQL ni
  da una FK; crecer exigiría tocar el `CHECK` en cada migración.
- **Temáticas gestionables desde el admin**: el arte es código; un formulario no puede crearlo.

## Consequences

- Quien entrena varias disciplinas tiene varias escaleras y no suma horas entre ellas; el ranking de medallas de toda la
  academia desaparece.
- Las medallas que enseña un alumno con «logros» dicen qué disciplinas hace y cuántas horas lleva en cada una, aunque no
  enseñe el campo «disciplinas».
