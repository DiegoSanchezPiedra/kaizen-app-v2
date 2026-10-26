// src/config/agreements.js
// Fuente de verdad de los tipos de agreement y sus versiones vigentes.
// Durante B4.5 las versiones viven aquí (hardcodeadas).
// En B4.5.1 pasan a leerse de `agreement_documents` (BD) vía
// `src/services/agreements.js#getCurrentVersion(type)`.
// El contrato de `requireCompleteProfile` NO cambia entre B4.5 y B4.5.1.

export const AGREEMENT_TYPES = ['waiver', 'data_protection', 'rights_of_image'];

// Semver-ish: "1.0", "1.1", "2.0". Bump manual al publicar una versión nueva.
// En B4.5.1, `getCurrentVersion(type)` devolverá la versión publicada en BD;
// estas constantes quedan solo como fallback / seed inicial.
export const CURRENT_AGREEMENT_VERSIONS = {
  waiver: '1.0',
  data_protection: '1.0',
  rights_of_image: '1.0',
};

// Validación al arrancar: todo tipo en AGREEMENT_TYPES debe tener versión,
// y toda versión debe tener tipo. Falla rápido si alguien añade un tipo
// y olvida la versión (o viceversa).
{
  const typeSet = new Set(AGREEMENT_TYPES);
  const versionKeys = Object.keys(CURRENT_AGREEMENT_VERSIONS);
  for (const type of AGREEMENT_TYPES) {
    if (!CURRENT_AGREEMENT_VERSIONS[type]) {
      throw new Error(
        `[config/agreements] Falta CURRENT_AGREEMENT_VERSIONS['${type}']. ` +
        `Tipos definidos: ${AGREEMENT_TYPES.join(', ')}.`
      );
    }
    if (!/^\d+\.\d+$/.test(CURRENT_AGREEMENT_VERSIONS[type])) {
      throw new Error(
        `[config/agreements] Versión inválida para '${type}': ` +
        `"${CURRENT_AGREEMENT_VERSIONS[type]}". Formato esperado: X.Y (ej. 1.0).`
      );
    }
  }
  for (const key of versionKeys) {
    if (!typeSet.has(key)) {
      throw new Error(
        `[config/agreements] CURRENT_AGREEMENT_VERSIONS tiene '${key}' ` +
        `pero no está en AGREEMENT_TYPES.`
      );
    }
  }
}