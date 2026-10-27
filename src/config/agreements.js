// src/config/agreements.js
// Tipos de acuerdo (ver CONTEXT.md). Las versiones vigentes viven en `agreement_documents`.
export const AGREEMENT_TYPES = Object.freeze(['waiver', 'data_protection', 'rights_of_image']);

// Semver-ish X.Y; etiqueta sin semántica.
export const VERSION_RE = /^\d+\.\d+$/;
