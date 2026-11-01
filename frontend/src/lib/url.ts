// Ruta con query string; los undefined no se mandan (para uno mismo no hay profile_id).
export function path(base: string, params: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined))
  return q.size ? `${base}?${q}` : base
}
