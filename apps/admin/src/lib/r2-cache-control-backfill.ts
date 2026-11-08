import { AwsV4Signer } from "aws4fetch"
import { CACHE_CONTROL_MEDIOS, type ShopMediaConfig } from "./shop-media"

/**
 * Lógica del backfill de Cache-Control del bucket público de medios
 * (`scripts/r2-cache-control-backfill.ts`). Vive en src/ para poder testearla
 * con los tests unitarios; el script sólo arma el entorno y la imprime.
 *
 * Por cada objeto: HEAD (content-type y cache-control actuales) y, si hace
 * falta, CopyObject sobre sí mismo con `MetadataDirective: REPLACE` para fijar
 * `Cache-Control` conservando el content-type (y content-disposition si lo
 * tenía). Los objetos se suben sin metadata propia (x-amz-meta-*), así que
 * REPLACE no pierde nada.
 */

/** Prefijos de imágenes/fichas que genera el sistema; nada más se toca. */
export const PREFIJOS_DEFAULT = ["productos/", "home/", "categorias/", "marca/"] as const

export interface Pagina {
  keys: string[]
  siguiente: string | null
}

/** Parsea una respuesta ListObjectsV2 (XML) sin dependencias. */
export function parsearListado(xml: string): Pagina {
  const keys = [...xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((m) => decodificarXml(m[1]!))
  const truncado = /<IsTruncated>true<\/IsTruncated>/.test(xml)
  const token = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1]
  return { keys, siguiente: truncado && token ? decodificarXml(token) : null }
}

function decodificarXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
}

/** `x-amz-copy-source`: /bucket/key con cada segmento codificado. */
export function copySource(bucket: string, key: string): string {
  return `/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`
}

export interface Cabeceras {
  contentType: string | null
  cacheControl: string | null
  contentDisposition: string | null
}

export type Accion = "copiar" | "ya-tiene" | "sin-content-type"

/** Qué hacer con un objeto según sus cabeceras actuales. */
export function decidir(h: Cabeceras, cacheControl: string = CACHE_CONTROL_MEDIOS): Accion {
  if (h.cacheControl?.trim() === cacheControl) return "ya-tiene"
  // Sin content-type no hay qué conservar: se avisa en vez de copiar a ciegas.
  if (!h.contentType) return "sin-content-type"
  return "copiar"
}

export interface Resultado {
  listados: number
  yaTenian: number
  copiados: number
  porCopiar: number
  sinContentType: number
  errores: number
}

export const resultadoVacio = (): Resultado => ({
  listados: 0,
  yaTenian: 0,
  copiados: 0,
  porCopiar: 0,
  sinContentType: 0,
  errores: 0,
})

type Cfg = Pick<ShopMediaConfig, "accountId" | "accessKeyId" | "secretAccessKey" | "bucket" | "region">

export interface Bucket {
  listar(prefijo: string, token: string | null): Promise<Pagina>
  head(key: string): Promise<Cabeceras | null>
  copiarSobreSiMismo(key: string, h: Cabeceras): Promise<void>
}

/** Cliente mínimo del bucket (List/Head/Copy) firmado con SigV4; `fetchFn` inyectable para tests. */
export function crearBucket(cfg: Cfg, fetchFn: typeof fetch = fetch, ahora: () => Date = () => new Date()): Bucket {
  const base = `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}`
  const datetime = () => ahora().toISOString().replace(/[:-]|\.\d{3}/g, "")

  async function firmado(method: string, url: string, headers?: Record<string, string>): Promise<Response> {
    const signer = new AwsV4Signer({
      method,
      url,
      headers,
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      service: "s3",
      region: cfg.region,
      datetime: datetime(),
    })
    const signed = await signer.sign()
    return fetchFn(new Request(signed.url.toString(), { method: signed.method, headers: signed.headers }))
  }

  const urlKey = (key: string) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`

  return {
    async listar(prefijo, token) {
      const q = new URLSearchParams({ "list-type": "2", prefix: prefijo, "max-keys": "1000" })
      if (token) q.set("continuation-token", token)
      const res = await firmado("GET", `${base}?${q}`)
      if (!res.ok) throw new Error(`List ${prefijo} respondió ${res.status}`)
      return parsearListado(await res.text())
    },

    async head(key) {
      const res = await firmado("HEAD", urlKey(key))
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`HEAD respondió ${res.status}`)
      return {
        contentType: res.headers.get("content-type"),
        cacheControl: res.headers.get("cache-control"),
        contentDisposition: res.headers.get("content-disposition"),
      }
    },

    async copiarSobreSiMismo(key, h) {
      const headers: Record<string, string> = {
        "x-amz-copy-source": copySource(cfg.bucket, key),
        "x-amz-metadata-directive": "REPLACE",
        "content-type": h.contentType!,
        "cache-control": CACHE_CONTROL_MEDIOS,
      }
      if (h.contentDisposition) headers["content-disposition"] = h.contentDisposition
      const res = await firmado("PUT", urlKey(key), headers)
      // S3 puede responder 200 con un <Error> en el cuerpo.
      const cuerpo = await res.text()
      if (!res.ok || /<Error>/.test(cuerpo)) throw new Error(`Copy respondió ${res.status}`)
    },
  }
}

/** Corre `tareas` con a lo sumo `limite` en vuelo. */
export async function conConcurrencia<T>(items: T[], limite: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  const worker = async () => {
    for (;;) {
      const idx = i++
      if (idx >= items.length) return
      await fn(items[idx]!)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limite, items.length)) }, worker))
}

/** Recorre los prefijos y aplica (o cuenta) el cambio. Una key con error no corta el resto. */
export async function correrBackfill(
  bucket: Bucket,
  o: { prefijos: readonly string[]; ejecutar: boolean; concurrencia: number; limite?: number; log?: (s: string) => void },
): Promise<Resultado> {
  const r = resultadoVacio()
  const log = o.log ?? (() => {})
  let restante = o.limite ?? Infinity

  for (const prefijo of o.prefijos) {
    let token: string | null = null
    do {
      if (restante <= 0) return r
      const pagina: Pagina = await bucket.listar(prefijo, token)
      const keys = pagina.keys.slice(0, restante)
      restante -= keys.length
      r.listados += keys.length
      await conConcurrencia(keys, o.concurrencia, async (key) => {
        try {
          const h = await bucket.head(key)
          if (!h) return // borrado entre el listado y el HEAD
          const accion = decidir(h)
          if (accion === "ya-tiene") r.yaTenian++
          else if (accion === "sin-content-type") {
            r.sinContentType++
            log(`  sin content-type, se saltea: ${key}`)
          } else if (!o.ejecutar) r.porCopiar++
          else {
            await bucket.copiarSobreSiMismo(key, h)
            r.copiados++
          }
        } catch (err) {
          r.errores++
          log(`  error en ${key}: ${err instanceof Error ? err.message : "error"}`)
        }
      })
      token = pagina.siguiente
      log(`  ${prefijo} · listados ${r.listados} · copiados ${r.copiados} · ya tenían ${r.yaTenian}`)
    } while (token)
  }
  return r
}

export function resumen(r: Resultado, ejecutar: boolean): string {
  return [
    ejecutar ? "EJECUTADO" : "DRY-RUN (no escribe)",
    `objetos listados ${r.listados}`,
    `ya tenían Cache-Control ${r.yaTenian}`,
    ejecutar ? `actualizados ${r.copiados}` : `a actualizar ${r.porCopiar}`,
    `sin content-type ${r.sinContentType} · errores ${r.errores}`,
  ].join("\n")
}
