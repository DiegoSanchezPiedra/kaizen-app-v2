# Medallas «shonen»: riesgo de PI y cómo lo hacen otras apps

> Investigación del 2026-11-09 para cambiar el aspecto de los badges de horas (`hours_10` … `hours_1000`), el del primer día
> y los de racha (`streak_4` … `streak_52`) de `frontend/src/lib/progress.ts` (códigos de la migración 019). Los códigos no
> cambian, solo el `title` y el arte. **No es asesoramiento jurídico**: lo marcado con ⚖ necesita un abogado de PI español.

## Resumen

- Los **títulos de las series, los nombres de personajes y los logotipos sí están registrados** por sus dueños (p. ej.
  ONE PIECE y GOKU, de Shueisha, en la USPTO). Están descartados en cualquier forma.
- Los **términos propios del universo** que se comprobaron (Super Saiyan, Hokage, Bankai, Shinigami, Grand Line, Yonko,
  Over 9000) **no tienen una marca viva de Shueisha, Toei, Viz, Pierrot ni Bird Studio en la USPTO**. Varios los han
  registrado o solicitado **terceros sin relación**. Eso no los hace seguros: siguen siendo signos que asocian con una obra
  de renombre (Ley de Competencia Desleal, arts. 6, 11 y 12) y pueden registrarse en cualquier momento. Quedan **descartados
  también**.
- En España, decir «inspirado en Naruto» o «tipo Dragon Ball» es justo lo que el art. 12 LCD llama desleal: usar un signo
  ajeno «acompañado de expresiones tales como "modelos", "sistema", "tipo", "clase"». **No hay que nombrar las series ni
  en la app ni en el marketing.**
- Las apps de referencia separan los hitos de forma más o menos geométrica, enseñan los que tienes en camino con su
  progreso (Apple), celebran el hito con una «transformación» a pantalla completa y una tarjeta para compartir (Duolingo)
  y dejan ocultar la racha (Headspace). Ninguna documenta en público la concesión retroactiva ni qué pasa en un dispositivo
  nuevo, así que eso es una decisión nuestra (ver § 2.5).

## 1. Riesgo de propiedad intelectual

### 1.1 Qué se comprobó en los registros

Las fichas de la USPTO se leyeron en TSDR (`tsdr.uspto.gov/statusview/sn<serie>`, fuente primaria). Los números de serie
se localizaron antes con agregadores (Justia, Markinton, trademarkdir), que solo sirven de pista.

| Término | Resultado (USPTO, fuente primaria salvo nota) | Dueño de la serie | Lectura |
|---|---|---|---|
| SUPER SAIYAN | Dos solicitudes de **Toei Animation**, clase 28 (juguetes): sn 75162849 (1996) y sn 76088506 (2000). Las dos **abandonadas** («no Statement of Use»). | Toei | Toei quiso la marca. Es un término acuñado de Dragon Ball. **No usar.** |
| GOKU | Reg. 2114595, **viva**, clase 28, hoy de **Kabushiki Kaisha Shueisha** (antes de Toei). | Shueisha/Toei | Los nombres de personaje se registran. **No usar.** |
| ONE PIECE | Reg. 8217416 (2026), **viva**, clases 16 y 28, Shueisha, vía Madrid (registro internacional 1846565). | Shueisha | Título registrado. **No usar.** |
| HUNTER X HUNTER | Reg. 3029999, **viva y renovada** (2025), clase 16, Shueisha. | Shueisha | Título registrado. **No usar.** |
| HOKAGE | sn 90341734, clase 28, solicitante chino sin relación (Jiangyuan Liu). **Abandonada.** | — | Acuñado (火影) y muy asociado a Naruto. **No usar.** |
| BANKAI | Reg. 8141012 (feb. 2026), **viva**, clases 16, 25 y 41, de **SHOBEK LLC** (Florida), sin relación con Bleach. La ficha lo traduce como «FULL RELEASE». | — | Acuñado por Tite Kubo y ya registrado por un tercero en la clase 41 (entretenimiento). Doble riesgo. **No usar**, y tampoco su traducción literal «liberación total». |
| SHINIGAMI | Reg. 5390923, **viva**, clases 9 y 10, de un particular chino (Liuye Hu). Traducción: «Death God». | — | Es una palabra común en japonés (死神); el riesgo nace de juntarla con katanas y túnicas negras. **No usar** en una lista que evoca Bleach. |
| GRAND LINE | Varias marcas vivas de empresas sin relación (marroquinería, juguetes, una fábrica de Virginia). *Nota: dato de agregador, no se abrió cada ficha en TSDR.* | — | Acuñado en One Piece. **No usar.** |
| YONKO | sn 99765683 (2026), clases 25 y 41, de un particular, **en trámite**. *Dato de agregador.* | — | Acuñado (四皇). **No usar.** |
| OVER 9000 | Dos solicitudes en clase 41 (2025), de terceros, en trámite. *Dato de agregador.* | — | Meme del doblaje de DBZ. **No usar.** |
| KAMEHAMEHA | No se encontró ninguna marca de Toei, Bandai ni Bird Studio. Hay un producto con licencia (la bebida «G Fuel Kamehameha» de Toei y Crunchyroll). | — | Es el nombre de un rey hawaiano, pero como técnica es inequívocamente Dragon Ball y se licencia como tal. **No usar.** |
| GENIN / CHUNIN / JONIN | No se encontró ninguna marca exacta (solo parecidas, p. ej. CHUNNIN, de un tercero, clase 28). | — | Son rangos del folclore ninja, pero juntos y en orden son la escalera de Naruto. **No usar** la escalera. |
| NEN | No se buscó como marca: «nen» (念) es una palabra japonesa común. | — | En una medalla de aura o energía evoca Hunter x Hunter directamente. **No usar.** |
| HUNTER LICENSE | No se encontró ninguna marca, solo merchandising oficial con forma de tarjeta. | — | La tarjeta es un elemento visual reconocible. **No usar** ni el término ni la tarjeta. |

**EUIPO**: eSearch y TMview son aplicaciones JavaScript que no se pudieron consultar de forma automática. Shueisha
registra sus títulos por el sistema de Madrid (ONE PIECE, registro internacional 1846565), y lo normal es que designe
también la UE. ⚖ **Pendiente**: buscar a mano en <https://euipo.europa.eu/eSearch/> y <https://www.tmdn.org/tmview/> cada
término de la tabla y los 11 nombres propuestos (§ 3), filtrando por las clases 9 (apps), 41 (formación, deporte,
entretenimiento) y 28, y a nombre de Shueisha, Toei, Viz, Pierrot, Bird Studio y Bandai.

### 1.2 Por qué «no registrado» no quiere decir «libre» (España/UE)

- **Marca renombrada**: la Ley 17/2001 de Marcas, art. 34.2.c, permite al titular de una marca con renombre en España
  impedir el uso de un signo **aunque los productos sean distintos**, si ese uso obtiene «una ventaja desleal del carácter
  distintivo o del renombre de la marca». DRAGON BALL, ONE PIECE y NARUTO tienen, casi seguro, renombre en España. El
  art. 9.2.c del Reglamento (UE) 2017/1001 dice lo mismo para la marca de la UE (no se pudo leer en EUR-Lex en esta sesión;
  ⚖ confirmarlo).
- **Competencia desleal** (Ley 3/1991, BOE-A-1991-628):
  - art. 6: es desleal lo que pueda crear confusión, y «el riesgo de asociación […] respecto de la procedencia de la
    prestación es suficiente».
  - art. 11.2: imitar es libre, salvo que la imitación pueda «generar la asociación» o suponga «un aprovechamiento indebido
    de la reputación o el esfuerzo ajeno».
  - art. 12: es desleal aprovecharse de la reputación ajena, y en particular usar signos ajenos con «expresiones tales como
    "modelos", "sistema", "tipo", "clase"». **Esto es el «inspirado en …»**.
- **Propiedad intelectual** (LPI, BOE-A-1996-8930): art. 10.2, «el título de una obra, cuando sea original, quedará
  protegido como parte de ella». Art. 21: adaptar o modificar una obra es transformarla y necesita autorización. Un arte
  «parecido» a un personaje o a un objeto icónico (sombrero de paja, bandana con placa, esfera naranja con estrellas,
  espada-guadaña…) puede ser transformación aunque se dibuje desde cero.
- **El género no es de nadie.** Las auras, los puños cerrados, los kanji, las líneas de velocidad, el mar, las espadas o
  la idea de «subir de nivel» con entrenamiento son tropos generales. Lo que no se puede tomar es la expresión concreta:
  nombres, diseños, combinaciones de colores y formas de una serie.

### 1.3 Pautas prácticas para «evocar» sin copiar

1. **Palabras de diccionario en español**, sin calcos de términos acuñados («liberación total» por «bankai», «voluntad de
   fuego» por «Will of Fire», «más allá» con «Plus Ultra», que además es de My Hero Academia).
2. **Ninguna serie nombrada** en la UI, las notificaciones, la tienda de apps, las redes ni la publicidad. En la
   documentación interna se puede hablar de la serie que se evoca; fuera, no.
3. **Arte original sin elementos firma**: nada de pelo dorado de punta, el gi naranja y azul, el sombrero de paja, la
   bandana con placa, la espiral, el haori blanco con kanji, la espada o la guarda característica de la serie, la tarjeta de
   licencia ni las esferas con estrellas. La paleta y el estilo, propios de Kaizen.
4. **No reproducir la escalera de rangos** de una serie (genin→chunin→jonin, capitán/teniente…).
5. **Evaluar el conjunto, no solo cada medalla**: once medallas que recorren en orden cinco series famosas pueden leerse
   como un aprovechamiento sistemático (art. 11 y 12 LCD), aunque cada pieza sea genérica. Cuanto más genéricas sean las
   piezas y menos se diga en público, menor el riesgo.

### 1.4 Lo que necesita abogado (⚖)

- Confirmar en EUIPO/TMview y en la OEPM que ninguno de los 11 nombres propuestos choca con una marca en las clases 9 y 41.
- Valorar el riesgo del **conjunto** (§ 1.3.5) frente a los arts. 11 y 12 LCD y al art. 34.2.c LM.
- Revisar el arte final antes de publicarlo: es lo que más se acerca a la transformación del art. 21 LPI.
- Si algún día se quiere **decir** en marketing «medallas inspiradas en el anime shonen», eso necesita una opinión previa.

## 2. Cómo lo hacen apps comparables

### 2.1 Separación entre niveles

- **Duolingo** (blog oficial, K. Hartfelder, 21-01-2022): celebra la racha a la semana, al mes, a los 100 días y al año
  («and beyond»), y menciona el día 1000. La versión anterior usaba 50, 100 y 365. Los logros tienen varios niveles,
  desde los de principiante hasta los raros, como un año de racha (blog oficial, J. Shuttleworth, 11-12-2023).
- **Khan Academy** (centro de ayuda, según el extracto del buscador; la página directa respondió 403): cinco niveles de
  rareza con un tema común, Meteorito, Luna, Tierra, Sol y Agujero Negro. Es un precedente directo de **escalera temática
  con nombres genéricos**.
- **Kaizen**: 10/50/100/250/500/1000 h es una progresión aproximadamente geométrica (×2 a ×5), y 4/12/26/52 semanas
  equivale a mes, trimestre, semestre y año, lo mismo que hace Duolingo. **No hace falta cambiar los umbrales.**

### 2.2 Bloqueada frente a conseguida

- **Apple Fitness**: el apartado Premios incluye «awards you're making progress towards» (Guía de uso del Apple Watch,
  support.apple.com). Según 9to5Mac (fuente secundaria), desde iOS 17 los que tienes en camino van arriba y los
  conseguidos debajo.
- **Strava** (soporte oficial): la vitrina solo enseña las insignias **conseguidas**, «in order of completion date, with
  your four most recent badges visible on your profile». No enseña las pendientes.
- **Duolingo** (2023): logros y hitos «collect on your profile like trophies on a shelf», en una sola vitrina.
- **Recomendación**: la siguiente medalla de cada escalera, bloqueada (silueta, sin el arte de color) y con su progreso
  («37 de 50 h»). El resto, bloqueadas pero visibles. Así se sabe qué falta sin destripar todo el arte. Para el lector de
  pantalla, «Bloqueada» debe decirse con texto y no solo con color.

### 2.3 La celebración al desbloquear

- **Duolingo**: el hito de racha se pensó como un «power up» de videojuego, en el que Duo «physically changed on these
  exciting days» y se convierte en un fénix en llamas. Lleva una tarjeta para compartir. Según el blog, las primeras
  métricas mostraban a más gente manteniendo la racha. **Es justo el tono shonen de la transformación, con un personaje
  propio.**
- **Duolingo** (2023): los récords personales dan «a shiny new badge to celebrate your win».
- **Apple**: el premio se enseña como un objeto en 3D que se puede girar arrastrando (Guía del Apple Watch).
- **Recomendación**: una sola pantalla o hoja con la medalla, su nombre y una frase. Animación corta (≤ 1 s, entrada y
  brillo), un botón «Seguir» y, como mucho, «Compartir». Solo al cruzar el umbral, nunca al abrir la vitrina.

### 2.4 Movimiento reducido (WCAG y Apple)

- **WCAG 2.3.3 (AAA)**: «Motion animation triggered by interaction can be disabled». Técnicas C39 y SCR40, con
  `prefers-reduced-motion`.
- **WCAG 2.2.2 (A)**: lo que se mueve solo más de 5 s junto a otro contenido tiene que poder pausarse. Nada de auras en
  bucle infinito en la vitrina.
- **WCAG 2.3.1 (A)**: como mucho 3 destellos por segundo, con un umbral propio para el rojo saturado. **Ojo con los
  destellos de «estallido de aura»**, típicos del género.
- **Apple HIG, Motion**: «Make motion optional», «Don't add motion for the sake of adding motion», y acompañar con
  háptica o sonido.
- **Recomendación**: con `prefers-reduced-motion: reduce`, la misma hoja con un fundido y sin escala, partículas ni
  destellos. El hito se comunica igual con el texto.

### 2.5 Concesión retroactiva y nueva celebración en otro dispositivo

- **No hay documentación pública de primera mano** en ninguna de las cinco apps. Lo más cercano:
  - Apple: hilos de la comunidad (no oficiales) dicen que los premios viven en los datos de Salud sincronizados con
    iCloud, y que el texto de soporte de Apple da hasta 9 días para que aparezca un premio. Es decir, los premios van con
    la cuenta, no con el dispositivo.
  - Strava: en un reto sin una única meta de distancia, la insignia «will not appear in your Trophy Case until you reach
    the final distance milestone» (soporte oficial). Se concede al cruzar el umbral, no al final.
  - Headspace (centro de ayuda, según el extracto del buscador): la racha se oculta con el ojo del Perfil, y si se reinicia
    por error, la corrige soporte.
- **Recomendación** (decisión propia, no copiada de nadie):
  - **Retroactiva**: el backend ya calcula los badges con el historial, así que con el nuevo aspecto todo alumno conserva
    lo que ya tenía. La primera vez que vea la vitrina, **un único aviso de resumen** («Tus horas ya cuentan: tienes 3
    medallas»), no tres celebraciones seguidas.
  - **Otro dispositivo**: marcar la celebración como vista **en el servidor** (por alumno y badge), no en
    `localStorage`. Si no, cada móvil nuevo, cada navegador o cada borrado de datos vuelve a lanzarla.
  - **Ocultar**: como en Headspace, una opción para no ver las rachas, porque hay alumnos que se lesionan o tienen que
    parar.

## 3. Propuesta: 11 nombres de medalla

Criterio: palabras de diccionario, sin calcos, ni nombres de serie, ni rangos de serie, ni traducciones de técnicas.
Reparto: Hunter x Hunter 3, Dragon Ball 2, One Piece 2, Bleach 2, Naruto 2. «Evoca» describe la intención interna y
**no se publica**.

| Código | Nombre | Evoca | Riesgo |
|---|---|---|---|
| `first_day` | **Aspirante** | Hunter x Hunter (el examen) | Bajo: palabra común. No acompañarla de una tarjeta ni de un «examen». |
| `hours_10` | **Aprendiz** | Naruto (la academia) | Bajo: genérico. No usar bandana con placa ni la espiral. |
| `hours_50` | **Sangre guerrera** | Dragon Ball (la estirpe guerrera) | Bajo: genérico. Evitar «raza guerrera», que se acerca a la descripción de los saiyan. |
| `hours_100` | **Mar abierto** | One Piece (zarpar) | Bajo: genérico. Nada de sombrero de paja, calavera con sombrero ni la palabra «Grand». |
| `hours_250` | **Filo despierto** | Bleach (la espada que se libera) | Bajo-medio: no es un calco de «bankai»/«full release», pero con katana y túnica negra se acercaría. Arte sin haori ni la guarda de espada característica de la serie. |
| `hours_500` | **Dominio del aura** | Hunter x Hunter (el nen) | Bajo-medio: «aura» es genérico en todo el género. No usar «nen» ni los esquemas de categorías. |
| `hours_1000` | **Más allá del límite** | Dragon Ball (la transformación) | Bajo-medio: frase común. Es la medalla con más tentación de copiar en el arte: nada de pelo dorado de punta ni aura amarilla con chispas. |
| `streak_4` | **Palabra cumplida** | Naruto (no rendirse y cumplir lo prometido) | Bajo: genérico. Evitar «nunca me rindo» o «mi camino», que son calcos del lema del protagonista. |
| `streak_12` | **Rumbo firme** | One Piece (la travesía) | Bajo: expresión náutica común. |
| `streak_26` | **Alma templada** | Bleach (las almas, el temple) | Bajo: genérico. Evitar «segador de almas», «dios de la muerte» o «shinigami». |
| `streak_52` | **Cazador veterano** | Hunter x Hunter (el cazador profesional) | Medio: «cazador» es común, pero es la palabra del título de la serie traducida. Si el abogado lo ve justo, la alternativa es **Rastreador incansable**. |

Comprobación previa (⚖): buscar los 11 nombres en EUIPO, TMview y OEPM en las clases 9 y 41.

## Fuentes

Registros (primarias):
- USPTO TSDR: [sn75162849](https://tsdr.uspto.gov/statusview/sn75162849) y [sn76088506](https://tsdr.uspto.gov/statusview/sn76088506) (SUPER SAIYAN, Toei, abandonadas); [sn75016440](https://tsdr.uspto.gov/statusview/sn75016440) (GOKU, Shueisha); [sn79420190](https://tsdr.uspto.gov/statusview/sn79420190) (ONE PIECE, Shueisha); [sn78149430](https://tsdr.uspto.gov/statusview/sn78149430) (HUNTER X HUNTER, Shueisha); [sn90341734](https://tsdr.uspto.gov/statusview/sn90341734) (HOKAGE, tercero, abandonada); [sn99065793](https://tsdr.uspto.gov/statusview/sn99065793) (BANKAI, SHOBEK LLC); [sn87503826](https://tsdr.uspto.gov/statusview/sn87503826) (SHINIGAMI, tercero).
- Pistas de agregador, no verificadas en TSDR: [GRAND LINE](https://trademark.justia.com/885/12/grand-88512469.html), [YONKO sn99765683](https://markinton.com/trademark/yonko-99765683), [OVER 9000 sn99250241](https://markinton.com/trademark/over-9000-99250241), [CHUNNIN sn98296857](https://markinton.com/trademark/chunnin-98296857), [G Fuel Kamehameha](https://www.thelicensingletter.com/tag/g-fuel/).

Leyes (primarias, BOE, texto consolidado):
- [Ley 3/1991, de Competencia Desleal](https://www.boe.es/buscar/act.php?id=BOE-A-1991-628), arts. 6, 11 y 12.
- [Ley 17/2001, de Marcas](https://www.boe.es/buscar/act.php?id=BOE-A-2001-23093), art. 34.2.
- [Texto refundido de la Ley de Propiedad Intelectual](https://www.boe.es/buscar/act.php?id=BOE-A-1996-8930), arts. 10.2 y 21.
- [Reglamento (UE) 2017/1001](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32017R1001), art. 9.2.c (no se pudo leer en esta sesión).

Apps (primarias salvo nota):
- Duolingo: [«You're on fire!», streak milestone](https://blog.duolingo.com/streak-milestone-design-animation) (2022); [Achievements](https://blog.duolingo.com/achievement-badges) (2023).
- Strava: [The Strava Trophy Case](https://support.strava.com/en-us/articles/15402068-the-strava-trophy-case).
- Apple: [Track daily activity with Apple Watch](https://support.apple.com/guide/watch/track-daily-activity-with-apple-watch-apd3bf6d85a6/watchos); [HIG, Motion](https://developer.apple.com/design/human-interface-guidelines/motion); secundaria: [9to5Mac sobre iOS 17](https://9to5mac.com/?p=900552); comunidad: [premios y copia de Salud](https://discussions.apple.com/thread/252446470).
- Headspace: [How does the run streak feature work](https://help.headspace.com/hc/en-us/articles/215730567-How-does-the-run-streak-feature-work) (403 directo; citado por el extracto del buscador).
- Khan Academy: [centro de ayuda, insignias](https://support.khanacademy.org/hc/en-us/articles/202487710-What-are-energy-points-) (403 directo; niveles según el extracto del buscador).

Accesibilidad (primarias, W3C):
- [WCAG 2.2, 2.3.3 Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html); [2.2.2 Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html); [2.3.1 Three Flashes](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html).

## Temáticas por disciplina (comprobación de nombres)

> Comprobación del 2026-11-09. **Límite honesto**: los wikis de Fandom devolvieron 402 y no hay doblaje de España indexado, así
> que solo lo marcado **[V]** se confirmó en una fuente citada; **[?]** viene de memoria de las ediciones/doblaje y hay que
> abrir el tomo o el capítulo antes de fijar el `title`. Las licencias no se tratan aquí. Sin manji ni Bankai.
> Fuentes: [ES Wikipedia, Personajes de Shingeki no Kyojin](https://es.wikipedia.org/wiki/Anexo:Personajes_de_Shingeki_no_Kyojin)
> («Ataque a los titanes» en España; 9 titanes con nombre en español; el de Ataque «no es el más fuerte ni rápido»);
> [Whakoom, edición de Norma](https://www.whakoom.com/freemann?e=433) (Norma Editorial, 34 tomos);
> [ES Wikipedia, Hajime no Ippo](https://es.wikipedia.org/wiki/Hajime_no_Ippo) («Espíritu de lucha», Kōdansha);
> [Planeta Cómic, Hajime no Ippo n.º 1](https://www.planetadelibros.com/libro-hajime-no-ippo-n-01/376439);
> [ES Wikipedia, Bleach](https://es.wikipedia.org/wiki/Bleach_(manga)) (Glénat/Tebeos en España; el doblaje dice «segadores de almas»);
> [ES Wikipedia, Hunter × Hunter](https://es.wikipedia.org/wiki/Hunter_%C3%97_Hunter) (Nen: Ten, Zetsu, Ren, Hatsu).
> Cambios marcados con **CAMBIO** frente a la propuesta.

### 1. Shingeki no Kyojin 進撃の巨人 (BJJ) — Norma Editorial

Nombres [V] en español: Titán Fundador, de Ataque, Colosal, Acorazado, Hembra, Mandíbula, Bestia, Carguero, Martillo de Guerra.
«Titán Puro» y «Excéntrico» **[?]**: el doblaje/Norma puede decir «titán anormal»; en el original son 無垢の巨人 *Muku no Kyojin*
y 奇行種 *Kikōshu* («especie de conducta extraña»), que es el término del manga.

| # | Titán (ES) | Japonés | Uso | Notas |
|---|---|---|---|---|
| 1 | Titán Puro | 無垢の巨人 *Muku no Kyojin* | horas: primer día | |
| 2 | Titán Excéntrico [?] | 奇行種 *Kikōshu* | 10 h | misma fuerza que el puro, más peligro: aceptable |
| 3 | Titán Carguero | 車力の巨人 *Shariki no Kyojin* | racha 4 sem | titán de apoyo, poco combate |
| 4 | Titán Mandíbula | 顎の巨人 *Ago no Kyojin* | 50 h | |
| 5 | Titán Hembra | 女型の巨人 *Onnagata no Kyojin* | 100 h | |
| 6 | Titán Acorazado | 鎧の巨人 *Yoroi no Kyojin* | racha 12 sem | |
| 7 | Titán Bestia | 獣の巨人 *Kemono no Kyojin* | 250 h | |
| 8 | Titán Martillo de Guerra | 戦槌の巨人 *Senchui no Kyojin* | racha 26 sem | |
| 9 | Titán de Ataque | 進撃の巨人 *Shingeki no Kyojin* | 500 h | |
| 10 | Titán Colosal | 超大型巨人 *Chōdaikata Kyojin* | racha 52 sem | |
| 11 | Titán Fundador | 始祖の巨人 *Shiso no Kyojin* | 1000 h | |

**Orden**: la obra **no ordena** los titanes por fuerza (ES Wikipedia: el de Ataque «no es el titán más fuerte ni rápido»), así
que el orden es una convención nuestra. Es defendible como gradiente de poder táctico (puro < apoyo < combate < Fundador, que
controla a todos los titanes de Ymir). **Sin cambio de orden**; punto discutible: Colosal (10) sobre Ataque (9) es opinable.
shortcut: orden de fuerza por convención, no canónico; revisar si un usuario lo discute o si el equipo prefiere Ataque > Colosal.
Medalla: **escudo de la Tropa de Exploración** (Alas de la Libertad; **CAMBIO** de nombre: en España es «Tropa de Exploración» [?],
«Reconocimiento» es la versión de Latinoamérica). Kanji: **巨** (*kyo*, gigante). Paleta: `#3D5A3A` `#8B6F47` `#E6E2D3`.

### 2. Dragon Ball ドラゴンボール (Muay Thai) — Planeta

| Escalera | Propuesta → corregida | Japonés | Nota |
|---|---|---|---|
| Horas | Guerrero Saiyan | サイヤ人 *Saiya-jin* | [?] en España suele ser «Saiyajin» (ortografía del doblaje/Planeta); fijar una y usarla igual en todos los títulos |
| | Super Saiyan | 超サイヤ人 *Super Saiya-jin* | |
| | Super Saiyan 2 | 超サイヤ人2 | |
| | Super Saiyan 3 | 超サイヤ人3 | |
| | Super Saiyan God → **Super Saiyan Dios** [?] | 超サイヤ人ゴッド | «God» no se traduce en el original; «Dios» es la forma castellana habitual |
| | Super Saiyan Blue → **Super Saiyan Azul** [?] | 超サイヤ人ブルー (formal: 超サイヤ人ゴッド超サイヤ人) | |
| | Ultra Instinto | 身勝手の極意 *Migatte no Gokui* | «Ultra Instinto» es el nombre de la versión localizada |
| Racha | Kaio-ken | 界王拳 *Kaiōken* | |
| | Super Saiyan 4 | 超サイヤ人4 | **no es canon de Toriyama** (Dragon Ball GT): sustituible por Super Saiyan Blue Kaio-ken (canon) si importa |
| | Super Saiyan Blue Evolucionado | 超サイヤ人ブルー進化 | |
| | Ultra Ego | ウルトラエゴ | Vegeta; nombre localizado |

El orden de ambas escaleras es coherente con el poder en la serie; **sin cambio de orden**. Las traducciones «Dios/Azul» y
«Saiyajin» sin verificar frente al doblaje de España.
Medalla: **esfera del dragón** con 1 a 7 estrellas (7 niveles de horas). Kanji: **龍** (*ryū*, dragón). Paleta: `#F28C28` `#1D4E9E` `#F7D117`.

### 3. Hajime no Ippo はじめの一歩 (Boxeo) — Planeta Cómic

Título en España: el manga sale como *Hajime no Ippo* (Planeta Cómic, tomos dobles); *Espíritu de lucha* es el título del anime en
España [V ES Wikipedia]. **CAMBIO**: la medalla de racha «Espíritu de lucha» es el título de la serie, no un golpe: se sustituye por **Smash** [?]
(スマッシュ, golpe del protagonista).

| Escalera | Nombre | Japonés | Nota |
|---|---|---|---|
| Horas | Gimnasio Kamogawa (ingreso) | 鴨川ボクシングジム | |
| | Licencia profesional | プロテスト合格 | |
| | **Rey de los novatos del Este de Japón** | 東日本新人王 | **CAMBIO** (sin «del Año»: «Novato del Año» no es el término; en la obra es el torneo «Rey de los novatos») |
| | Rey de los novatos de Japón | 全日本新人王 | |
| | Campeón de Japón (peso pluma) | 日本フェザー級王者 | «peso pluma» [V] |
| | Campeón OPBF | 東洋太平洋王者 | OPBF [V] |
| | Campeón del mundo | 世界王者 | |
| Racha | Peek-a-boo | ピーカブースタイル | |
| | Gazelle Punch | ガゼルパンチ | |
| | Dempsey Roll | デンプシー・ロール | |
| | ~~Espíritu de lucha~~ → Smash [?] | スマッシュ | verificar el golpe en un tomo antes de fijarlo |

Los tres golpes de la propuesta se confirman como técnicas de Ippo (ficha de personaje; fuente no oficial). Personaje para el nombre/código
de la temática: **Ippo Makunouchi 幕之内一歩 → código `ippo`** (alternativa sin nombre completo: `kamogawa`, el gimnasio).
Medalla: **cinturón de campeón**. Kanji: **拳** (*ken*, puño). Paleta: `#B1121B` `#C9A227` `#111111`.

### 4. One Piece ワンピース (Muay Thai Kids) — Planeta

| Escalera | Propuesta → corregida | Japonés | Nota |
|---|---|---|---|
| Horas | Grumete / Pirata novato | 見習い / 新人海賊 | |
| | Nakama | 仲間 | se deja «nakama» en Planeta [?] |
| | Supernova | 超新星 *Chōshinsei* | [?] «Los Once Supernovas» |
| | Shichibukai → **Los Siete Grandes Corsarios** [?] | 王下七武海 | «Siete Guerreros del Mar» es la versión latinoamericana; el sistema se abolió en la obra |
| | Yonkō → **Los Cuatro Emperadores** [?] | 四皇 *Yonkō* | |
| | Rey de los Piratas | 海賊王 *Kaizoku-ō* | |
| Racha | Gear Second / Third / Fourth / Fifth | ギア2 / 3 / 4 / 5 | orden por aparición y poder: correcto. Gear Fifth = ギアフィフス; 5 es la forma «Nika» |

Sin cambios de orden. Medalla: **cartel de «Se busca»** con recompensa creciente (para niños, quitar la palabra «Vivo o muerto»).
Kanji: **海** (*umi*, mar). Paleta: `#E8D9B0` `#8B1E1E` `#1B3A5C`.

### 5. Libres

**Naruto ナルト (Planeta)** — horas: Estudiante de la Academia (アカデミー生), Genin (下忍), Chūnin (中忍), Jōnin (上忍), ANBU (暗部), Sannin (伝説の三忍),
Hokage (火影). Racha: **CAMBIO** de orden: Rasengan (螺旋丸) → **Modo Sabio** (仙人モード) → **Rasen-shuriken** (螺旋手裏剣) → Modo Sabio de los Seis Caminos
(六道仙人モード). Motivo: el Rasen-shuriken lo usa Naruto dentro del Modo Sabio, que ya domina; verificar capítulo [?]. «Seis Caminos» solo
da «Modo Seis Caminos»: el nombre es «Modo Sabio de los Seis Caminos» [?]. Medalla: **placa de bandana ninja**. Kanji **忍** (*shinobi*). Paleta `#F07F13` `#1F2A44` `#C0C7D0`.

**Bleach ブリーチ (Glénat/Tebeos)** — horas: Alma (魂魄), Estudiante de la Academia Shinō (真央霊術院), Shinigami (死神), **CAMBIO**: Shikai (始解) **antes** que
Teniente (副隊長), Capitán del Gotei 13 (護廷十三隊 隊長), Capitán Comandante (総隊長). Motivo: el teniente ya ha liberado el shikai; la capitanía
exige Bankai (no se usa aquí). «Shinigami» [V] frente a «segadores de almas» del doblaje en España: elegir uno y ser coherente (propuesta: Shinigami,
es el nombre del manga). Racha: Shunpo (瞬歩), Kidō (鬼道), Getsuga Tenshō (月牙天衝), Mugetsu (無月): orden correcto. Medalla: **insignia de teniente / haori del Gotei 13**.
Kanji **魂** (*tamashii*, alma). Paleta `#0B0B0F` `#F2F2F2` `#E86A10`.

**Hunter x Hunter ハンターハンター (Glénat/Tebeos [?])** — horas sin cambios: Aspirante al Examen Hunter (ハンター試験), Licencia Hunter (ハンター証),
Piso 200 de la Torre Celeste (天空闘技場 200階; «Torre Celestial» [?]), Hunter de una / dos / tres estrellas (一ツ星 / 二ツ星 / 三ツ星),
Presidente de la Asociación (協会会長). Racha: Ten (纏), Zetsu (絶), Ren (練), Hatsu (発) [V, orden de Wikipedia]. Medalla: **licencia Hunter**.
Kanji **念** (*nen*). Paleta `#1B6B3A` `#F5D90A` `#1A1A2E`.

### Resumen de cambios

1. AoT: «Tropa de Reconocimiento» → «Tropa de Exploración» [?]; orden de titanes sin cambio (no canónico).
2. Dragon Ball: «God/Blue» → «Dios/Azul» [?]; SS4 es de GT (no canon de Toriyama).
3. Ippo: «Novato del Año del Este» → «Rey de los novatos del Este de Japón»; «Espíritu de lucha» (título del anime) → «Smash» [?]; código `ippo`.
4. One Piece: «Siete Guerreros del Mar» → «Los Siete Grandes Corsarios» [?]; «Yonkō» → «Los Cuatro Emperadores» [?].
5. Naruto: Modo Sabio pasa antes de Rasen-shuriken. Bleach: Shikai pasa antes de Teniente. HxH sin cambios.
shortcut: los [?] no se pudieron confirmar en línea (Fandom 402, sin acceso al doblaje de España); cotejar con un tomo de Norma/Planeta/Glénat antes de fijar el `title`.
