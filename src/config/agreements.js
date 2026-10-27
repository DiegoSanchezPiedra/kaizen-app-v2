// src/config/agreements.js
// Versiones vigentes de cada agreement (hardcodeadas en B4.5).
// En B4.5.1 se leen de `agreement_documents` vía `services/agreements.js#getCurrentVersions`
// y este archivo desaparece.

// Semver-ish: "1.0", "1.1", "2.0". Bump manual al publicar una versión nueva.
export const CURRENT_AGREEMENT_VERSIONS = Object.freeze({
  waiver: '1.0',
  data_protection: '1.0',
  rights_of_image: '1.0',
});

export const AGREEMENT_TYPES = Object.keys(CURRENT_AGREEMENT_VERSIONS);

for (const [type, version] of Object.entries(CURRENT_AGREEMENT_VERSIONS)) {
  if (!/^\d+\.\d+$/.test(version)) {
    throw new Error(`[config/agreements] Versión inválida para '${type}': "${version}". Formato esperado: X.Y`);
  }
}
