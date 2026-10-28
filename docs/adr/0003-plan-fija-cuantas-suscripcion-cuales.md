# El plan fija cuántas disciplinas; la suscripción fija cuáles

El esquema inicial asumía que un plan cubre una lista fija de disciplinas (`plan_disciplines`). Pero la academia vende planes de "1 disciplina", "2 disciplinas" y "todas", en los que el alumno **elige** cuáles y puede cambiarlas. Por eso el plan guarda solo **cuántas** disciplinas se eligen, y lo que se cubre son las **disciplinas elegidas** de cada suscripción (`subscription_disciplines`). `plan_disciplines` se conserva con otro significado: una lista opcional de **disciplinas elegibles**, que hace falta para que un plan barato (p. ej. Kids) no pueda usarse para elegir disciplinas de adultos.

Se descartó crear un plan por cada combinación de disciplinas, porque haría explotar el catálogo y convertiría cada cambio de disciplina en un cambio de plan. También se descartó permitir varias suscripciones de una disciplina por alumno, porque esquivaría el precio de los planes de 2 y "todas" y obligaría a B7 a revisar varias suscripciones.

El precio de esta decisión es que "¿qué cubre a este alumno?" depende de la suscripción y no solo del plan, y que el nombre `plan_disciplines` engaña: no son las disciplinas cubiertas. Volver atrás supondría rehacer el esquema de B5, la comprobación de cobertura de B7 y el checkout y los cambios de plan de B10.
