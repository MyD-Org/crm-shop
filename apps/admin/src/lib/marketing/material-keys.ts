// Material que sube el equipo (videos y fotos del celular) al bucket público del shop, bajo
// `marketing/{tenant}/material/{piezaId}/`. El prefijo ata el archivo a ESTA pieza: la ruta
// valida la key que manda el navegador antes de persistirla.
const MB = 1024 * 1024
export interface TipoMaterial { tipo: "video" | "foto"; ext: string; maxBytes: number }
export const TIPOS_MATERIAL: Record<string, TipoMaterial> = {
  "video/mp4": { tipo: "video", ext: "mp4", maxBytes: 300 * MB },
  "video/quicktime": { tipo: "video", ext: "mov", maxBytes: 300 * MB },
  "image/jpeg": { tipo: "foto", ext: "jpg", maxBytes: 20 * MB },
  "image/png": { tipo: "foto", ext: "png", maxBytes: 20 * MB },
  "image/webp": { tipo: "foto", ext: "webp", maxBytes: 20 * MB },
}

/** Busca el tipo SÓLO entre las claves propias: `TIPOS_MATERIAL["constructor"]` no es un tipo. */
export function tipoMaterial(contentType: string): TipoMaterial | null {
  return Object.hasOwn(TIPOS_MATERIAL, contentType) ? TIPOS_MATERIAL[contentType] : null
}

const TENANT_ID_RE = /^[a-z0-9-]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function materialKey(tenantId: string, piezaId: string, id: string, contentType: string): string {
  const tipo = tipoMaterial(contentType)
  if (!tipo) throw new Error(`tipo de material no permitido: ${contentType}`)
  if (!TENANT_ID_RE.test(tenantId)) throw new Error(`tenantId inválido para key de R2: ${JSON.stringify(tenantId)}`)
  if (!UUID_RE.test(piezaId) || !UUID_RE.test(id)) throw new Error("id inválido para key de R2")
  return `marketing/${tenantId}/material/${piezaId}/${id}.${tipo.ext}`
}

export function esKeyDeMaterial(tenantId: string, piezaId: string, key: string): boolean {
  const prefijo = `marketing/${tenantId}/material/${piezaId}/`
  if (!key.startsWith(prefijo)) return false
  const resto = key.slice(prefijo.length)
  const [id, ext] = resto.split(".")
  return UUID_RE.test(id ?? "") && Object.values(TIPOS_MATERIAL).some((t) => t.ext === ext) && resto === `${id}.${ext}`
}
