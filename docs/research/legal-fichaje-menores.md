# Investigación legal: fichaje de profesores, login de menores y retirada del waiver y del seguro

Fecha: 10 de noviembre de 2026. Ámbito: España (normativa estatal y de la UE, con algunos ejemplos autonómicos).

Fuentes: siempre que ha sido posible, primarias (BOE, EUR-Lex, AEPD, Ministerio de Trabajo, Congreso, Consejo de Estado). Lo que no se ha podido confirmar con una fuente primaria se marca como **INCIERTO**. Esto no es asesoramiento jurídico; las secciones "A validar con un profesional" indican qué conviene revisar con un abogado laboralista, un delegado de protección de datos o un corredor de seguros.

Método de comprobación del estado de la normativa: búsquedas en la API de legislación consolidada del BOE (`boe.es/datosabiertos/api/legislacion-consolidada`), que incluye disposiciones publicadas hasta el 5 de noviembre de 2026, y lectura de los textos consolidados (el ET se actualizó por última vez el 21-10-2026, la LISOS el 03-10-2026 y la LOPDGDD el 27-12-2025).

---

## Resumen ejecutivo

1. **Fichaje (registro de jornada).** Es obligatorio para los profesores **empleados** desde 2019 (art. 34.9 ET). Hay que registrar el inicio y el fin de cada jornada diaria, conservar los registros 4 años y ponerlos a disposición de los trabajadores, de sus representantes y de la Inspección. Si no se cumple, es una infracción grave (art. 7.5 LISOS), con multas de 751 € a 7.500 € (art. 40.1.b LISOS). Para los profesores a tiempo parcial, además, hay que totalizar las horas cada mes y entregar el resumen junto con la nómina (art. 12.4.c ET).
2. **Real decreto de registro digital.** A 10-11-2026 **no está aprobado ni publicado en el BOE**. El Consejo de Ministros autorizó su tramitación urgente el 30-9-2025, y el Consejo de Estado emitió el **Dictamen 188/2026 (19-3-2026): "no procede aprobar el Real Decreto proyectado"**. Sus objeciones se refieren a la protección de datos, a la reserva de ley y a la remisión a la negociación colectiva. Aun así, conviene diseñar el fichaje según el borrador, porque es barato y anticipa lo que pide hoy la Inspección: registro digital, modificaciones con autoría y rastro, acceso inmediato y exportación en un formato tratable.
3. **Autónomos.** No existe obligación de registrar su jornada. Además, **no conviene** someterlos al mismo fichaje que a los empleados, porque controlar su horario es un indicio de dependencia que puede llevar a recalificarlos como trabajadores asalariados (arts. 1.1 y 8.1 ET).
4. **Biometría y geolocalización.** La AEPD considera la biometría para el control de presencia un tratamiento de alto riesgo, que exige una EIPD y para el que el consentimiento del empleado no sirve como base. La geolocalización se admite con información previa y expresa al trabajador (art. 90 LOPDGDD), pero debe ser proporcionada. **Recomendación: ni biometría ni GPS. Basta con fichar en la app autenticado, opcionalmente con un QR o una red del centro.**
5. **Menores con login propio.** Hoy, los menores de 14 años necesitan el consentimiento de su tutor para los tratamientos basados en el consentimiento (art. 7 LOPDGDD). El **Proyecto de Ley Orgánica de protección de menores en entornos digitales** subiría esa edad a **16**; a junio de 2026 seguía en ponencia en el Congreso y **no está aprobado** (INCIERTO si hubo avances entre julio y noviembre, aunque no consta en el BOE). Conviene diseñar ya con el umbral configurable y preparado para 16.
6. **Diseño para menores.** Requisitos: minimización (art. 5.1.c RGPD) y privacidad por defecto (art. 25 RGPD), es decir, sin perfil público, sin aparecer en rankings públicos con nombre ni foto y sin marketing. Las notificaciones push y los emails deben ser solo operativos, y las comunicaciones comerciales deben ir solo al tutor. Las fotos de menores solo pueden difundirse con consentimiento (art. 92 LOPDGDD, LO 1/1982 art. 3), y nunca de forma contraria a su interés, aunque haya consentimiento (LO 1/1996 art. 4.3). Muy probablemente hará falta una **EIPD**, porque se tratan datos de menores de 14 años (criterio 9 de la lista de la AEPD) y se cumple al menos otro criterio.
7. **Waiver.** En contratos con consumidores es **nula** cualquier cláusula que excluya o limite la responsabilidad de la academia por muerte o lesiones (art. 86.2 TRLGDCU), y nunca se puede renunciar a la responsabilidad por dolo (art. 1102 CC). Por tanto, quitar el waiver como exención de responsabilidad apenas reduce la protección jurídica real de la academia. Sí conviene conservar un **documento de información de riesgos, normas y declaración de aptitud**, que no es una exención.
8. **Seguro.** La Ley 39/2022 del Deporte **no impone un seguro de RC general** a las academias privadas. Solo exige el seguro obligatorio deportivo (accidentes) a los **federados** en competición oficial estatal (art. 23.2.e; prestaciones mínimas del RD 849/1993) y seguros a los organizadores de competiciones oficiales (art. 86.g). Sin embargo, **varias leyes autonómicas sí obligan** a tener un seguro de RC a centros y prestadores de servicios deportivos: Asturias (Ley 5/2022, arts. 69 y 98), País Vasco (Ley 2/2023, art. 87) e Illes Balears (Ley 2/2023, arts. 143 y 152). Dejar de **vender** un seguro a los alumnos es posible; lo que **no** se puede dejar es el seguro de RC de la propia academia si lo exige su comunidad autónoma.
9. **Hallazgo adicional.** La LOPIVI (LO 8/2021, art. 48) obliga a las entidades que realizan actividades deportivas con menores de forma habitual a aplicar protocolos frente a la violencia y a designar un **Delegado/a de protección**. Esto afecta al diseño de la mensajería entre profesores y menores.

---

## 1. Registro de jornada (fichaje de profesores)

### Qué dice la norma

**Obligación vigente: art. 34.9 ET** (añadido por el art. 10 del RDL 8/2019). Texto literal en el BOE consolidado (actualizado el 21-10-2026):

> "La empresa garantizará el registro diario de jornada, que deberá incluir el horario concreto de inicio y finalización de la jornada de trabajo de cada persona trabajadora [...] La empresa conservará los registros [...] durante cuatro años y permanecerán a disposición de las personas trabajadoras, de sus representantes legales y de la Inspección de Trabajo y Seguridad Social."

- Fuentes: [ET, art. 34.9](https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430#a3-6) y [RDL 8/2019, art. 10](https://www.boe.es/buscar/doc.php?id=BOE-A-2019-3481).
- La organización del registro se fija por negociación colectiva o acuerdo de empresa; en su defecto, por decisión del empresario previa consulta con los representantes (mismo art. 34.9).
- **Tiempo parcial: art. 12.4.c ET.** La jornada se registra día a día, se totaliza mensualmente y se entrega al trabajador una copia del resumen junto con la nómina ([ET, art. 12](https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430#a12)). Es relevante, porque muchos profesores de academia trabajan a tiempo parcial.
- **Criterios del Ministerio.** La [Guía sobre el registro de jornada (Ministerio de Trabajo, 2019)](https://www.mites.gob.es/ficheros/ministerio/GuiaRegistroJornada.pdf) admite cualquier soporte (papel o digital) siempre que el registro sea fiable y no se pueda manipular.

**Sanciones**
- Art. 7.5 LISOS, infracción **grave**: "La transgresión de las normas [...] en materia de jornada, [...] registro de jornada y, en general, el tiempo de trabajo a que se refieren los artículos 12, 23 y 34 a 38 del Estatuto de los Trabajadores" ([LISOS, art. 7.5](https://www.boe.es/buscar/act.php?id=BOE-A-2000-15060#a7)).
- Art. 40.1.b LISOS: multas por infracción grave de 751–1.500 € (grado mínimo), 1.501–3.750 € (grado medio) y 3.751–7.500 € (grado máximo) ([LISOS, art. 40](https://www.boe.es/buscar/act.php?id=BOE-A-2000-15060#a40)).
- Hoy la multa por el art. 7.5 **no se multiplica por trabajador afectado** (solo lo hacen el art. 7.2 y el 7.14). La sanción por trabajador que figuraba en el anteproyecto de ley de reducción de jornada de 2025 no está en vigor ([Referencia del Consejo de Ministros, 4-2-2025](https://www.lamoncloa.gob.es/consejodeministros/referencias/Paginas/2025/20250204-referencia-rueda-de-prensa-ministros.aspx)). **INCIERTO**: no se ha verificado con fuente primaria la tramitación posterior de ese anteproyecto en el Congreso; según la prensa, decayó en septiembre de 2025.

**Real decreto de registro horario digital: estado a 10-11-2026**
- 30-9-2025: el Consejo de Ministros "autoriza la tramitación administrativa urgente" del proyecto de RD que desarrolla el ET en materia de registro de jornada ([Referencia del Consejo de Ministros, 30-9-2025](https://www.lamoncloa.gob.es/consejodeministros/referencias/paginas/2025/20250930-referencia-rueda-de-prensa-ministros.aspx)).
- 19-3-2026: **Dictamen del Consejo de Estado 188/2026**, aprobado por unanimidad con un voto concurrente: "a la vista de las observaciones esenciales formuladas en los apartados VI, VII y VIII de este dictamen, **no procede aprobar el Real Decreto proyectado**". Esos apartados tratan de la protección de datos y la reserva de ley para desarrollar derechos fundamentales (VI), del ET, el control de la jornada y la potestad reglamentaria (VII) y de la remisión a la negociación colectiva (VIII). También pide que la entrada en vigor sea el 2 de enero o el 1 de julio (art. 23 de la Ley del Gobierno). Texto del dictamen, alojado por laboral-social.com y no en un dominio oficial: [Dictamen 188/2026](https://www.laboral-social.com/sites/laboral-social.com/files/188_2026.pdf).
- **No figura en el BOE.** La API de legislación consolidada del BOE no devuelve ningún real decreto con "registro de jornada" en el título publicado en 2025 o 2026, y el texto del art. 34.9 ET sigue siendo el de 2019 en la versión consolidada del 21-10-2026. **Conclusión: no aprobado.** Según la prensa, el Gobierno quería aprobarlo antes del verano y después en septiembre de 2026; **INCIERTO** si se ha aprobado en un Consejo de Ministros de los últimos días sin publicarse aún.
- **Qué exigiría el borrador** (texto sometido a consulta, [proyecto de RD en la web del Ministerio de Trabajo](https://expinterweb.mites.gob.es/participa/listado/download/6cb63e79-48a8-4e99-9784-3a0b26ae6106); la versión enviada al Consejo de Estado era distinta, por ejemplo con una "disposición final sexta"):
  - Art. 2.1: registro diario **por medios digitales**.
  - Art. 2.2: registro **objetivo, fiable y accesible**. "Fiable" significa que los asientos no pueden modificarse sin autorización de la empresa y del trabajador y que toda modificación deja "una huella clara e indeleble de los cambios realizados y de su autoría" (**inalterabilidad y trazabilidad**).
  - Art. 2.3: minimización, idoneidad, necesidad y proporcionalidad en materia de datos.
  - Art. 3, contenido mínimo: identificación del trabajador; régimen de jornada y porcentaje de parcialidad; inicio y fin de cada jornada **y de cada pausa** no computable, con hora y minuto; modalidad presencial o a distancia; horas ordinarias, extraordinarias o complementarias; tiempos de espera; interrupciones de la desconexión; horas derivadas de medidas de conciliación; **totales diarios y mensuales**; autoría y autorizaciones de cada modificación.
  - Art. 4: asiento "libre, personal, directa e inmediata" al empezar y al terminar. Las modificaciones requieren el acuerdo de ambas partes y, si no lo hay, la empresa refleja el cambio y el trabajador su discrepancia. Si hay una incidencia técnica, se registra en otro medio y después se digitaliza. El registro no puede ubicarse en zonas de acceso público. Los asientos se conservan **4 años**.
  - Art. 5: requisitos técnicos por desarrollo posterior, o sistema alternativo con un informe de un técnico competente.
  - Art. 6: el trabajador consulta y copia sus asientos "en cualquier momento y de forma inmediata", y recibe un resumen con la nómina. Los representantes acceden con los datos minimizados (sin DNI, domicilio ni estado civil). La **Inspección accede "de manera remota y presencial"**. Formato "**tratable, legible y compatible** con los formatos y sistemas de uso generalizado", es decir, exportable.
  - Art. 7: protocolo de organización del registro y formación computada como tiempo de trabajo.
  - Disposición final segunda: modifica el reglamento de la Inspección para permitir requerimientos de acceso presencial o remoto.

**Criterio de la AEPD sobre biometría y geolocalización**
- **Biometría.** Según la [Guía sobre tratamientos de control de presencia mediante sistemas biométricos (AEPD, noviembre de 2023)](https://www.aepd.es/guias/guia-control-presencia-biometrico.pdf), la AEPD considera la biometría, tanto para identificación como para autenticación, un tratamiento de alto riesgo con categorías especiales de datos (art. 9 RGPD). En el ámbito laboral, el consentimiento no levanta la prohibición por el desequilibrio entre las partes, y la EIPD es obligatoria antes de implantarla. El Dictamen 188/2026 recoge también las objeciones de la AEPD y de terceros a la biometría por reserva de ley.
- **Geolocalización.** El art. 90 LOPDGDD la admite para las funciones de control del art. 20.3 ET, con información previa "expresa, clara e inequívoca" a los trabajadores y a sus representantes ([LOPDGDD, art. 90](https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673#a9-3)). Véase también [La protección de datos en las relaciones laborales (AEPD)](https://www.aepd.es/guias/la-proteccion-de-datos-en-las-relaciones-laborales.pdf), que exige proporcionalidad y minimización (art. 5.1.c RGPD).

**Autónomos**
- El art. 34.9 ET se aplica a la "empresa" respecto de sus trabajadores. El ET solo cubre a quienes prestan servicios "por cuenta ajena y dentro del ámbito de organización y dirección de otra persona" ([ET, art. 1.1](https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430#a1)). Por tanto, **no hay obligación de registrar la jornada de un autónomo**.
- **Riesgo de laboralidad.** El art. 8.1 ET presume que existe contrato de trabajo entre quien presta un servicio por cuenta y dentro del ámbito de organización y dirección de otro y quien lo recibe a cambio de una retribución ([ET, art. 8.1](https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430#a8)). Los indicios habituales de dependencia y ajenidad (horario fijado por la academia, control de asistencia, medios de la academia, retribución fija, integración en el cuadro organizativo) proceden de la jurisprudencia del Tribunal Supremo; **INCIERTO**: no se ha citado aquí una sentencia concreta verificada en CENDOJ.

### Qué implica para la app

- **Empleados:**
  - Fichaje de entrada y salida (y de pausas, para estar preparados para el RD) en la propia PWA, autenticado y con sello de tiempo del servidor, no del dispositivo.
  - **Registro append-only.** Una corrección crea un nuevo asiento que enlaza con el anterior e incluye autor, fecha, motivo y aceptación del trabajador, o su discrepancia.
  - Totales diarios y mensuales. Resumen mensual descargable para la nómina, obligatorio para los contratos a tiempo parcial.
  - Exportación CSV/PDF por trabajador y rango de fechas, también para la Inspección.
  - El profesor ve sus propios registros en cualquier momento. El admin ve todos.
  - Conservación mínima de 4 años; purga o anonimización después, según la política de conservación.
  - Sin biometría ni GPS. Si se quiere comprobar la presencia, basta con un QR en el centro o con comprobar la IP o la red del local, previa información al trabajador (art. 90 LOPDGDD, por analogía).
- **Autónomos:**
  - **No incluirlos en el fichaje.** Si hace falta, registrar solo **clases impartidas o servicios prestados** para facturar, sin hora de entrada y salida ni control de presencia.
  - Que el modelo de datos distinga el tipo de relación (empleado o autónomo) y que la pantalla de fichaje solo aparezca para los empleados.
- **Accesos de terceros.** No hace falta un "portal de la Inspección" mientras el RD no esté aprobado; con la exportación bajo demanda es suficiente. Los representantes de los trabajadores, si los hay, deben recibir los datos minimizados.

### A validar con un profesional

- **Convenio colectivo aplicable** (instalaciones deportivas y gimnasios, u otro). Puede regular cómo se organiza el registro.
- Si se ha consultado a la representación legal o se ha documentado la decisión del empresario (art. 34.9 ET).
- **Situación real de cada profesor autónomo:** riesgo de falso autónomo, que afecta también a la Seguridad Social.
- Estado del RD de registro digital justo antes de lanzar el fichaje, consultando el BOE.

---

## 2. Menores: login propio y protección de datos

### Qué dice la norma

**Consentimiento y edad**
- **Art. 8.1 RGPD.** Para ofrecer directamente a niños servicios de la sociedad de la información, el tratamiento basado en el consentimiento es lícito a partir de los 16 años. Los Estados pueden bajar esa edad hasta los 13. Por debajo de esa edad, el consentimiento debe darlo o autorizarlo el titular de la patria potestad.
- **Art. 8.2 RGPD.** El responsable "hará esfuerzos razonables para verificar" que el consentimiento lo dio el titular de la patria potestad, "teniendo en cuenta la tecnología disponible" ([RGPD, art. 8](https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:32016R0679#d1e1990-1-1)).
- **Art. 7 LOPDGDD.** Fija la edad en **14 años**. Por debajo, el tratamiento basado en el consentimiento solo es lícito si consta el del titular de la patria potestad o tutela, "con el alcance que determinen" estos ([LOPDGDD, art. 7](https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673#a7)).
- **Matiz importante.** El art. 8 solo se aplica cuando la base es el **consentimiento**. Los datos necesarios para la relación con la academia (inscripción, asistencia, grados, pagos) se basan en el contrato firmado con el tutor (art. 6.1.b RGPD). Lo que se basaría en el consentimiento es lo opcional: foto pública, ranking, comunicaciones no necesarias, etc.

**Menores en internet**
- **Art. 84 LOPDGDD.** Los padres procuran un uso equilibrado y responsable. La difusión de imágenes o de información de menores en redes que suponga una intromisión ilegítima conlleva la intervención del Ministerio Fiscal ([LOPDGDD, art. 84](https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673#a8-7)).
- **Art. 92 LOPDGDD.** Las personas físicas o jurídicas "que desarrollen actividades en las que participen menores" deben garantizar el interés superior del menor al publicar sus datos en servicios de la sociedad de la información. Si la publicación es en redes sociales o servicios equivalentes, necesitan el consentimiento del menor o de sus representantes conforme al art. 7 ([LOPDGDD, art. 92](https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673#a9-5)).

**Principios del RGPD**
- **Minimización, art. 5.1.c RGPD:** datos "adecuados, pertinentes y limitados a lo necesario".
- **Privacidad desde el diseño y por defecto, art. 25 RGPD.** Por defecto solo se tratan los datos necesarios para cada fin y, en particular, los datos personales no pueden hacerse accesibles a un número indeterminado de personas sin intervención de la persona (art. 25.2).
- **Considerando 38 RGPD.** Los niños merecen una protección específica, en especial en la mercadotecnia y en la elaboración de perfiles.
- Fuente: [RGPD (EUR-Lex)](https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:32016R0679).

**EIPD (art. 35 RGPD)**
- La [lista de la AEPD de tratamientos que requieren EIPD (art. 35.4)](https://www.aepd.es/documento/listas-dpia-es-35-4.pdf) incluye, en su criterio 9, los "datos de sujetos vulnerables [...] incluyendo datos de menores de 14 años". En general, la EIPD es exigible cuando se cumplen **dos o más** criterios de la lista.
- En esta app, otros criterios plausibles son la elaboración de perfiles o evaluación (grados, rankings, progresión) y los datos de salud (lesiones o aptitud, si se recogen). **Probablemente exigible**, aunque la conclusión depende del inventario real de datos.

**Imagen de menores**
- **LO 1/1982, art. 3.** El menor consiente por sí mismo si su madurez lo permite. En los demás casos consiente su representante legal **por escrito**, con conocimiento previo del Ministerio Fiscal ([LO 1/1982, art. 3](https://www.boe.es/buscar/act.php?id=BOE-A-1982-11196#atercero)). **INCIERTO**: la aplicación práctica de la comunicación al Fiscal en las fotos de actividades ordinarias es una cuestión discutida; hay que consultarlo.
- **LO 1/1996, art. 4.3.** Es intromisión ilegítima cualquier uso de la imagen o del nombre del menor en los medios que pueda menoscabar su honra o reputación o sea contrario a sus intereses, "**incluso si consta el consentimiento** del menor o de sus representantes legales" ([LO 1/1996, art. 4](https://www.boe.es/buscar/act.php?id=BOE-A-1996-1069#a4)).

**Guías de la AEPD sobre menores**
- [Decálogo de principios: verificación de edad y protección de menores (AEPD, 2023)](https://www.aepd.es/guias/decalogo-principios-verificacion-edad-proteccion-menores.pdf), centrado en el acceso a contenidos para adultos. Sus principios de no identificar, no localizar y no perfilar a los menores son útiles como criterio de diseño.
- [Nota técnica "Internet seguro por defecto para la infancia" (AEPD)](https://www.aepd.es/guias/nota-tecnica-internet-seguro-por-defecto-para-la-infancia.pdf).

**Novedades legislativas 2025-2026**
- **Proyecto de Ley Orgánica para la protección de las personas menores de edad en los entornos digitales** (Congreso 121/000052, [BOCG 11-4-2025](https://www.congreso.es/public_oficiales/L15/CONG/BOCG/A/BOCG-15-A-52-1.PDF)):
  - Modifica el art. 7 LOPDGDD para subir la edad de consentimiento de **14 a 16 años**, y el art. 12.6 para que los padres ejerzan los derechos de los menores de 16.
  - Su disposición transitoria única mantiene válidos los consentimientos ya prestados por menores de 16 mientras no se revoquen.
- **Estado.** Existe un [documento de enmiendas in voce aprobadas en Ponencia (24-6-2026)](https://www.congreso.es/enmiendas/comisiones/15_303_121_000052/121-52_Enm_in_voce_aprobadas_en_Ponencia_24-06-2026.pdf), es decir, seguía en Comisión. No aparece en el BOE (la API de legislación consolidada no devuelve resultados para "entornos digitales"). **No aprobada. INCIERTO** si ha avanzado desde julio de 2026.
- **DSA (Reglamento 2022/2065), art. 28.** Obliga a las plataformas en línea accesibles a menores a garantizar un alto nivel de privacidad y seguridad y prohíbe la publicidad basada en perfiles a menores. Sin embargo, el art. 19 excluye de esa sección a las micro y pequeñas empresas ([DSA (EUR-Lex)](https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:32022R2065)). Además, una app interna de academia probablemente no es una "plataforma en línea" (**INCIERTO**, no aplicable con alta probabilidad).
- **LOPIVI (LO 8/2021), art. 48.** Las entidades que realizan "de forma habitual actividades deportivas o de ocio con personas menores de edad" deben aplicar los protocolos frente a la violencia, implantar un sistema de monitorización y designar un **Delegado/a de protección** ([LO 8/2021, art. 48](https://www.boe.es/buscar/act.php?id=BOE-A-2021-9347#a4-8)).

**Comunicaciones electrónicas**
- **LSSI, art. 21.** Las comunicaciones comerciales por email u otro medio equivalente requieren autorización previa, salvo que exista una relación contractual previa y se trate de productos o servicios similares ([LSSI, art. 21](https://www.boe.es/buscar/act.php?id=BOE-A-2002-13758#a21)).

### Qué implica para la app

- **Alta del menor.**
  - Solo puede iniciarla el **tutor desde su cuenta**: el tutor invita al hijo y elige qué funciones activa ("con el alcance que determinen", art. 7.2 LOPDGDD).
  - Esto es una verificación razonable (art. 8.2 RGPD) porque el tutor ya está identificado por su relación contractual y de pago con la academia.
  - No hace falta un sistema externo de verificación de edad. La fecha de nacimiento ya consta en la ficha.
- **Umbral de edad configurable** (hoy 14; preparado para 16). Si se aprueba la ley, los consentimientos ya prestados por menores de entre 14 y 16 años siguen siendo válidos (disposición transitoria única del proyecto).
- **Privacidad por defecto** (art. 25.2 RGPD):
  - Sin perfil público.
  - Sin nombre completo ni foto en rankings o vistas visibles para terceros. Si hay ranking, que sea opcional, con alias o iniciales, visible solo dentro de la academia y activado por el tutor.
  - Sin búsqueda del menor por otros usuarios.
- **Funciones limitadas.** Ver horario, asistencia, grados y avisos. El menor **no** puede pagar, cambiar datos de contacto ni aceptar documentos o consentimientos, que quedan reservados al tutor.
- **Mensajería.** Nada de canal privado 1:1 entre profesor y menor sin visibilidad del tutor. Es una cuestión de diseño de protección (LOPIVI art. 48 y los protocolos de la entidad), no un mandato literal de la norma.
- **Push y email.**
  - Al menor, solo avisos operativos: clase cancelada, recordatorios.
  - Nada comercial ni promocional, por el considerando 38 RGPD y porque el consentimiento del art. 21 LSSI lo daría el tutor.
  - Las comunicaciones comerciales van solo al tutor.
  - Que el email del menor sea opcional. Se puede usar login por invitación o código gestionado por el tutor para no recoger el email del menor (minimización).
- **Fotos.**
  - Por defecto, no publicar fotos de menores fuera de la app.
  - Consentimiento específico y separado del tutor (y del menor si es maduro), revocable.
  - Ninguna imagen que pueda ser contraria a su interés, aunque haya consentimiento (LO 1/1996 art. 4.3).
- **EIPD** antes de lanzar el login de menores, y actualización del registro de actividades del tratamiento y de la cláusula informativa, en lenguaje comprensible para el menor (art. 12.1 RGPD).

### A validar con un profesional (DPD o abogado)

- Si la EIPD es obligatoria con el inventario real de datos y, en su caso, su redacción.
- Las bases de licitud por cada finalidad (contrato frente a consentimiento).
- El procedimiento del consentimiento de imagen (LO 1/1982 art. 3, comunicación al Fiscal).
- El estado de la LO de entornos digitales antes del lanzamiento.
- Las obligaciones de la LOPIVI y la normativa autonómica sobre protocolos en el ámbito deportivo, incluida la designación del Delegado/a de protección.

---

## 3. Waiver (exención de responsabilidad) y seguro

### Qué dice la norma

**Validez de las exenciones**
- **Art. 1102 CC.** "La responsabilidad procedente del dolo es exigible en todas las obligaciones. La renuncia de la acción para hacerla efectiva es nula."
- **Art. 1103 CC.** La responsabilidad por negligencia "es igualmente exigible", aunque los tribunales pueden moderarla.
- Fuente: [Código Civil, arts. 1102 y 1103](https://www.boe.es/buscar/act.php?id=BOE-A-1889-4763#a1102).
- **Art. 1902 CC.** Responsabilidad extracontractual por culpa o negligencia.
- **Art. 1903 CC.** Los dueños de establecimientos responden de los daños causados por sus dependientes. Los titulares de un "Centro docente de enseñanza no superior" responden de los daños que causen sus alumnos menores mientras estén bajo vigilancia del profesorado. La responsabilidad cesa si se prueba la diligencia de un buen padre de familia ([Código Civil, art. 1903](https://www.boe.es/buscar/act.php?id=BOE-A-1889-4763#a1903)). **INCIERTO** si una academia de artes marciales encaja como "centro docente" a estos efectos.
- **TRLGDCU, art. 86.2.** Es abusiva "en cualquier caso" la cláusula que prevea "la exclusión o limitación de la responsabilidad del empresario en el cumplimiento del contrato, por los daños o por la muerte o por las lesiones causadas al consumidor y usuario por una acción u omisión de aquél" ([TRLGDCU, art. 86](https://www.boe.es/buscar/act.php?id=BOE-A-2007-20555#a86)).
- **Consecuencias.** Las cláusulas abusivas son nulas de pleno derecho y se tienen por no puestas (art. 83 TRLGDCU).
- **Asunción del riesgo inherente al deporte.** Es un criterio jurisprudencial, no legal: **INCIERTO**, sin sentencia concreta verificada aquí. Informar de los riesgos ayuda a probar la diligencia, pero no exonera.

**Seguros**
- **Ley 39/2022 del Deporte** ([BOE](https://www.boe.es/buscar/act.php?id=BOE-A-2022-24430)):
  - Art. 22.2.c: los deportistas federados tienen derecho a la cobertura de accidentes mediante seguro.
  - **Art. 23.2.e**: los federados que participen en competiciones oficiales de ámbito estatal deben tener un **seguro obligatorio** que cubra los riesgos para la salud.
  - Art. 23.3, modificado por la Ley 5/2025: las prestaciones mínimas se fijarán por reglamento. Hay un mandato de aprobarlo en seis meses (disposición final cuarta bis); no consta en el BOE.
  - Art. 86.g: los organizadores de **competiciones oficiales** deben tener seguros de accidentes y de RC.
  - Art. 104.g: no suscribir los seguros obligatorios "previstos en esta ley" es infracción **muy grave**.
  - **No se ha encontrado en esta ley una obligación general de RC para gimnasios o academias privadas.**
- **RD 849/1993** ([BOE](https://www.boe.es/buscar/act.php?id=BOE-A-1993-16129)). Fija las prestaciones mínimas del Seguro Obligatorio Deportivo, solo para deportistas federados. Sigue vigente según la API del BOE (no derogado).
- **Ejemplos autonómicos de RC obligatoria:**
  - **Asturias**, [Ley 5/2022 de Actividad Física y Deporte](https://www.boe.es/buscar/act.php?id=BOE-A-2022-11961):
    - Art. 69: la prestación de servicios profesionales de actividad física o deporte "precisa la previa suscripción del oportuno seguro de responsabilidad civil".
    - Art. 98: los establecimientos deportivos deben tener un seguro obligatorio de RC **y accidentes**.
    - Art. 103: no tener el seguro de RC es infracción.
  - **País Vasco**, [Ley 2/2023](https://www.boe.es/buscar/act.php?id=BOE-A-2023-10639), art. 87: la explotación de centros deportivos y la prestación de servicios deportivos están sujetas al seguro de RC obligatorio.
  - **Illes Balears**, [Ley 2/2023](https://www.boe.es/buscar/act.php?id=BOE-A-2023-13669):
    - Art. 143: RC obligatoria para los titulares de instalaciones de uso público.
    - Art. 152: RC profesional para el ejercicio profesional.
  - Otras comunidades (Andalucía, Madrid, Cataluña, etc.) no se han revisado: **INCIERTO** según dónde esté la academia.

### Qué implica para la app

- **Quitar el waiver** como cláusula de exención es coherente con la ley, porque esa cláusula era nula frente a consumidores (art. 86.2 TRLGDCU). Conviene **sustituirlo**, no eliminarlo sin más, por un documento que el tutor acepte con fecha y versión:
  - información de riesgos de la actividad;
  - normas del dojo;
  - declaración de aptitud física o de comunicación de condiciones médicas relevantes (dato de salud: categoría especial del art. 9 RGPD, con acceso restringido);
  - consentimiento de imagen por separado.
- **Quitar la venta del seguro** a los alumnos es posible, porque ninguna norma estatal obliga a la academia a venderlo. Pero:
  - si los alumnos compiten federados, el seguro les llega con la licencia federativa, no con la academia;
  - la academia debe mantener su **propio seguro de RC** (y de accidentes si su comunidad lo exige, como en Asturias), con independencia de lo que muestre la app.
- **Cambios en la app.** Retirar el producto "seguro" del catálogo o del checkout y los textos que lo prometen. Revisar las condiciones generales y la información precontractual para que no mencionen coberturas que ya no existen.

### A validar con un profesional

- La **ley del deporte de la comunidad autónoma** donde opera la academia: RC obligatoria, accidentes, capitales mínimos y titulación del profesorado.
- La póliza de RC vigente de la academia (cobertura de lesiones a alumnos y de menores, capitales) con el corredor.
- La redacción del nuevo documento de información de riesgos y normas, para que no contenga cláusulas abusivas.
- Si el art. 1903 CC (centro docente) se aplica a la academia.
- Si los alumnos que compiten necesitan licencia federativa y qué seguro incluye.

---

## Fuentes

**Laboral**
- Estatuto de los Trabajadores (RDLeg 2/2015), arts. 1, 8, 12, 20, 34: https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430
- Real Decreto-ley 8/2019: https://www.boe.es/buscar/doc.php?id=BOE-A-2019-3481
- LISOS (RDLeg 5/2000), arts. 7.5 y 40: https://www.boe.es/buscar/act.php?id=BOE-A-2000-15060
- Ministerio de Trabajo, Guía sobre el registro de jornada: https://www.mites.gob.es/ficheros/ministerio/GuiaRegistroJornada.pdf
- Proyecto de RD de registro de jornada (texto de consulta): https://expinterweb.mites.gob.es/participa/listado/download/6cb63e79-48a8-4e99-9784-3a0b26ae6106
- Referencia del Consejo de Ministros, 30-9-2025: https://www.lamoncloa.gob.es/consejodeministros/referencias/paginas/2025/20250930-referencia-rueda-de-prensa-ministros.aspx
- Referencia del Consejo de Ministros, 4-2-2025 (anteproyecto de reducción de jornada): https://www.lamoncloa.gob.es/consejodeministros/referencias/Paginas/2025/20250204-referencia-rueda-de-prensa-ministros.aspx
- Consejo de Estado, Dictamen 188/2026 (copia alojada por un tercero): https://www.laboral-social.com/sites/laboral-social.com/files/188_2026.pdf
- API de legislación consolidada del BOE: https://www.boe.es/datosabiertos/api/legislacion-consolidada

**Protección de datos y menores**
- RGPD (Reglamento UE 2016/679), arts. 5, 6, 8, 9, 12, 25, 35 y considerando 38: https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:32016R0679
- LOPDGDD (LO 3/2018), arts. 7, 84, 90, 92: https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673
- LO 1/1982, art. 3: https://www.boe.es/buscar/act.php?id=BOE-A-1982-11196
- LO 1/1996, art. 4: https://www.boe.es/buscar/act.php?id=BOE-A-1996-1069
- LO 8/2021 (LOPIVI), art. 48: https://www.boe.es/buscar/act.php?id=BOE-A-2021-9347
- LSSI (Ley 34/2002), art. 21: https://www.boe.es/buscar/act.php?id=BOE-A-2002-13758
- DSA (Reglamento UE 2022/2065), arts. 19 y 28: https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:32022R2065
- AEPD, Guía de control de presencia biométrico: https://www.aepd.es/guias/guia-control-presencia-biometrico.pdf
- AEPD, La protección de datos en las relaciones laborales: https://www.aepd.es/guias/la-proteccion-de-datos-en-las-relaciones-laborales.pdf
- AEPD, Listas de tratamientos que requieren EIPD (art. 35.4): https://www.aepd.es/documento/listas-dpia-es-35-4.pdf
- AEPD, Decálogo de verificación de edad: https://www.aepd.es/guias/decalogo-principios-verificacion-edad-proteccion-menores.pdf
- AEPD, Nota técnica "Internet seguro por defecto para la infancia": https://www.aepd.es/guias/nota-tecnica-internet-seguro-por-defecto-para-la-infancia.pdf
- Congreso, Proyecto de LO de entornos digitales (BOCG 15-A-52-1): https://www.congreso.es/public_oficiales/L15/CONG/BOCG/A/BOCG-15-A-52-1.PDF
- Congreso, Ponencia 24-6-2026: https://www.congreso.es/enmiendas/comisiones/15_303_121_000052/121-52_Enm_in_voce_aprobadas_en_Ponencia_24-06-2026.pdf

**Civil, consumo y deporte**
- Código Civil, arts. 1102, 1103, 1902, 1903: https://www.boe.es/buscar/act.php?id=BOE-A-1889-4763
- TRLGDCU (RDLeg 1/2007), arts. 83 y 86: https://www.boe.es/buscar/act.php?id=BOE-A-2007-20555
- Ley 39/2022 del Deporte, arts. 22, 23, 86, 104: https://www.boe.es/buscar/act.php?id=BOE-A-2022-24430
- RD 849/1993, Seguro Obligatorio Deportivo: https://www.boe.es/buscar/act.php?id=BOE-A-1993-16129
- Asturias, Ley 5/2022, arts. 69, 98, 103: https://www.boe.es/buscar/act.php?id=BOE-A-2022-11961
- País Vasco, Ley 2/2023, art. 87: https://www.boe.es/buscar/act.php?id=BOE-A-2023-10639
- Illes Balears, Ley 2/2023, arts. 143 y 152: https://www.boe.es/buscar/act.php?id=BOE-A-2023-13669
