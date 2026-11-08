import { describe, expect, it, vi } from "vitest"
import {
  conConcurrencia,
  copySource,
  correrBackfill,
  crearBucket,
  decidir,
  parsearListado,
  type Bucket,
  type Cabeceras,
} from "./r2-cache-control-backfill"
import { CACHE_CONTROL_MEDIOS } from "./shop-media"

const WEBP: Cabeceras = { contentType: "image/webp", cacheControl: null, contentDisposition: null }

describe("parsearListado", () => {
  it("lee keys (decodificando XML) y el token si está truncado", () => {
    const xml = `<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>tok&amp;1</NextContinuationToken>
      <Contents><Key>productos/t/1/a-800.webp</Key></Contents><Contents><Key>home/t/a&amp;b.webp</Key></Contents></ListBucketResult>`
    expect(parsearListado(xml)).toEqual({ keys: ["productos/t/1/a-800.webp", "home/t/a&b.webp"], siguiente: "tok&1" })
  })

  it("última página: sin token", () => {
    expect(parsearListado("<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>k</Key></Contents></ListBucketResult>").siguiente).toBeNull()
  })
})

describe("copySource / decidir", () => {
  it("codifica cada segmento y conserva las barras", () => {
    expect(copySource("b", "productos/t/mdp:12/a b.webp")).toBe("/b/productos/t/mdp%3A12/a%20b.webp")
  })

  it("copia sólo si no tiene ya el header y hay content-type", () => {
    expect(decidir(WEBP)).toBe("copiar")
    expect(decidir({ ...WEBP, cacheControl: CACHE_CONTROL_MEDIOS })).toBe("ya-tiene")
    expect(decidir({ ...WEBP, cacheControl: "max-age=60" })).toBe("copiar")
    expect(decidir({ ...WEBP, contentType: null })).toBe("sin-content-type")
  })
})

describe("crearBucket.copiarSobreSiMismo", () => {
  const cfg = { accountId: "acc", accessKeyId: "AK", secretAccessKey: "SK", bucket: "shop-media", region: "auto" }

  it("PUT con copy-source, REPLACE, content-type y cache-control", async () => {
    const fetchFn = vi.fn<(r: Request) => Promise<Response>>(async () => new Response("<CopyObjectResult/>", { status: 200 }))
    await crearBucket(cfg, fetchFn as unknown as typeof fetch, () => new Date("2026-11-08T00:00:00Z")).copiarSobreSiMismo(
      "productos/t/1/a-800.webp",
      { ...WEBP, contentDisposition: 'inline; filename="a.webp"' },
    )
    const req = fetchFn.mock.calls[0]![0]
    expect(req.method).toBe("PUT")
    expect(req.url).toBe("https://acc.r2.cloudflarestorage.com/shop-media/productos/t/1/a-800.webp")
    expect(req.headers.get("x-amz-copy-source")).toBe("/shop-media/productos/t/1/a-800.webp")
    expect(req.headers.get("x-amz-metadata-directive")).toBe("REPLACE")
    expect(req.headers.get("content-type")).toBe("image/webp")
    expect(req.headers.get("cache-control")).toBe(CACHE_CONTROL_MEDIOS)
    expect(req.headers.get("content-disposition")).toBe('inline; filename="a.webp"')
  })

  it("200 con <Error> en el cuerpo cuenta como fallo", async () => {
    const fetchFn = vi.fn(async () => new Response("<Error><Code>InternalError</Code></Error>", { status: 200 }))
    await expect(crearBucket(cfg, fetchFn as unknown as typeof fetch).copiarSobreSiMismo("k", WEBP)).rejects.toThrow()
  })
})

function bucketFalso(objetos: Record<string, Cabeceras>, tamPagina = 2) {
  const copiados: string[] = []
  const bucket: Bucket = {
    async listar(prefijo, token) {
      const todas = Object.keys(objetos).filter((k) => k.startsWith(prefijo))
      const desde = token ? Number(token) : 0
      const keys = todas.slice(desde, desde + tamPagina)
      return { keys, siguiente: desde + tamPagina < todas.length ? String(desde + tamPagina) : null }
    },
    async head(key) {
      return objetos[key] ?? null
    },
    async copiarSobreSiMismo(key) {
      if (key.includes("falla")) throw new Error("boom")
      copiados.push(key)
    },
  }
  return { bucket, copiados }
}

describe("correrBackfill", () => {
  const objetos = {
    "productos/t/1/a-800.webp": WEBP,
    "productos/t/1/b-800.webp": { ...WEBP, cacheControl: CACHE_CONTROL_MEDIOS },
    "productos/t/1/c-800.webp": WEBP,
    "home/t/v/d-800.webp": WEBP,
    "otros/x.webp": WEBP,
  }

  it("dry-run: cuenta sin copiar; sólo recorre los prefijos pedidos y pagina", async () => {
    const { bucket, copiados } = bucketFalso(objetos)
    const r = await correrBackfill(bucket, { prefijos: ["productos/", "home/"], ejecutar: false, concurrencia: 4 })
    expect(r).toMatchObject({ listados: 4, yaTenian: 1, porCopiar: 3, copiados: 0, errores: 0 })
    expect(copiados).toEqual([])
  })

  it("ejecutar: copia los que faltan y un error no corta el resto", async () => {
    const { bucket, copiados } = bucketFalso({ ...objetos, "productos/t/1/falla-800.webp": WEBP })
    const r = await correrBackfill(bucket, { prefijos: ["productos/", "home/"], ejecutar: true, concurrencia: 2, log: () => {} })
    expect(copiados.sort()).toEqual(["home/t/v/d-800.webp", "productos/t/1/a-800.webp", "productos/t/1/c-800.webp"])
    expect(r).toMatchObject({ copiados: 3, yaTenian: 1, errores: 1 })
  })

  it("--limite corta tras N objetos", async () => {
    const { bucket } = bucketFalso(objetos)
    const r = await correrBackfill(bucket, { prefijos: ["productos/", "home/"], ejecutar: false, concurrencia: 1, limite: 2 })
    expect(r.listados).toBe(2)
  })
})

describe("conConcurrencia", () => {
  it("nunca supera el límite de tareas en vuelo", async () => {
    let enVuelo = 0
    let max = 0
    await conConcurrencia([1, 2, 3, 4, 5, 6], 2, async () => {
      enVuelo++
      max = Math.max(max, enVuelo)
      await new Promise((r) => setTimeout(r, 5))
      enVuelo--
    })
    expect(max).toBe(2)
  })
})
