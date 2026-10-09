import { describe, expect, it } from "vitest"
import nextConfig from "../../next.config"
import { headersDeSeguridad, origenSentry, politicaCsp } from "./headers-seguridad"

describe("headersDeSeguridad", () => {
  it("manda nosniff, referrer, frame SAMEORIGIN (el portal enmarca sus PDF), permisos y HSTS", () => {
    const h = Object.fromEntries(headersDeSeguridad({}).map(({ key, value }) => [key, value]))
    expect(h["X-Content-Type-Options"]).toBe("nosniff")
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin")
    expect(h["X-Frame-Options"]).toBe("SAMEORIGIN")
    expect(h["Permissions-Policy"]).toContain("camera=()")
    expect(h["Strict-Transport-Security"]).toMatch(/^max-age=\d+$/)
  })

  it("la CSP va en Report-Only: nunca enforcing todavía", () => {
    const keys = headersDeSeguridad({}).map((h) => h.key)
    expect(keys).toContain("Content-Security-Policy-Report-Only")
    expect(keys).not.toContain("Content-Security-Policy")
    const h = Object.fromEntries(headersDeSeguridad({}).map(({ key, value }) => [key, value]))
    expect(h["Content-Security-Policy-Report-Only"]).toContain("default-src 'self'")
  })

  it("next.config: la regla general cubre todas las rutas y la del correo viene después (la última gana)", async () => {
    const reglas = await nextConfig.headers!()
    const iGeneral = reglas.findIndex((r) => r.source === "/:path*")
    const iCorreo = reglas.findIndex((r) => r.source === "/admin/correo/:path*")
    expect(iGeneral).toBeGreaterThanOrEqual(0)
    expect(iCorreo).toBeGreaterThan(iGeneral)
    const csp = (i: number) => reglas[i].headers.find((h) => h.key === "Content-Security-Policy-Report-Only")!.value
    const general = Object.fromEntries(reglas[iGeneral].headers.map((x) => [x.key, x.value]))
    expect(general["X-Frame-Options"]).toBe("SAMEORIGIN")
    expect(general["Content-Security-Policy"]).toBeUndefined()
    expect(csp(iGeneral)).not.toMatch(/img-src [^;]*https:(?:[ ;]|$)/)
    expect(csp(iCorreo)).toMatch(/img-src [^;]*https:(?:[ ;]|$)/)
  })
})

describe("politicaCsp", () => {
  const directiva = (csp: string, nombre: string) => csp.split("; ").find((p) => p.startsWith(`${nombre} `))

  it("frame-ancestors es 'self' (no 'none'): el portal enmarca sus PDF del mismo origen", () => {
    const csp = politicaCsp({})
    expect(directiva(csp, "frame-ancestors")).toBe("frame-ancestors 'self'")
    expect(directiva(csp, "frame-src")).toContain("'self'")
    expect(directiva(csp, "frame-src")).toContain("blob:")
  })

  it("trae todas las directivas base con los orígenes fijos del CRM", () => {
    const csp = politicaCsp({ NODE_ENV: "production" })
    expect(directiva(csp, "default-src")).toBe("default-src 'self'")
    expect(directiva(csp, "script-src")).toBe("script-src 'self' 'unsafe-inline'")
    expect(directiva(csp, "style-src")).toBe("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com")
    expect(directiva(csp, "font-src")).toBe("font-src 'self' data: https://fonts.gstatic.com")
    expect(directiva(csp, "img-src")).toBe("img-src 'self' data: blob: https://*.r2.cloudflarestorage.com")
    expect(directiva(csp, "media-src")).toBe("media-src 'self' blob: https://*.r2.cloudflarestorage.com")
    expect(directiva(csp, "connect-src")).toBe("connect-src 'self' https://*.r2.cloudflarestorage.com")
    expect(directiva(csp, "frame-src")).toBe("frame-src 'self' blob: https://*.r2.cloudflarestorage.com")
    expect(directiva(csp, "worker-src")).toBe("worker-src 'self' blob:")
    expect(directiva(csp, "form-action")).toBe("form-action 'self'")
    expect(directiva(csp, "base-uri")).toBe("base-uri 'self'")
    expect(directiva(csp, "object-src")).toBe("object-src 'none'")
    // Nada de scripts externos: Sentry y el widget de chat van en el bundle propio.
    expect(directiva(csp, "script-src")).not.toContain("https://")
  })

  it("Sentry: el origen de ingesta se deriva del DSN, sin la clave, y sólo si está", () => {
    const dsn = "https://clave-publica-de-prueba@o123.ingest.sentry.example/456"
    expect(origenSentry(dsn)).toBe("https://o123.ingest.sentry.example")
    expect(origenSentry(undefined)).toBeNull()
    expect(origenSentry("cualquier cosa")).toBeNull()
    expect(origenSentry("http://o123.ingest.sentry.example/456")).toBeNull()

    const con = politicaCsp({ NEXT_PUBLIC_SENTRY_DSN: dsn })
    expect(directiva(con, "connect-src")).toContain("https://o123.ingest.sentry.example")
    expect(con).not.toContain("clave-publica-de-prueba")
    expect(con).not.toContain("/456")
    expect(politicaCsp({})).not.toContain("sentry")
  })

  it("fotos del catálogo: el origen de R2_SHOP_MEDIA_PUBLIC_URL en img-src sólo si está (y sólo el origen)", () => {
    const con = politicaCsp({ R2_SHOP_MEDIA_PUBLIC_URL: "https://fotos.plataforma.example/catalogo/" })
    expect(directiva(con, "img-src")).toContain("https://fotos.plataforma.example")
    expect(con).not.toContain("/catalogo")
    // Sólo en img-src: las fotos no se piden por fetch ni se enmarcan.
    expect(directiva(con, "connect-src")).not.toContain("fotos.plataforma.example")
    expect(politicaCsp({})).not.toContain("plataforma.example")
    expect(politicaCsp({ R2_SHOP_MEDIA_PUBLIC_URL: "http://inseguro.example" })).not.toContain("inseguro.example")
    expect(politicaCsp({ R2_SHOP_MEDIA_PUBLIC_URL: "no es una url" })).not.toContain("no es una url")
  })

  it("'unsafe-eval' y ws: sólo en desarrollo", () => {
    const prod = politicaCsp({ NODE_ENV: "production" })
    expect(prod).not.toContain("unsafe-eval")
    expect(prod).not.toContain("ws:")
    const dev = politicaCsp({ NODE_ENV: "development" })
    expect(directiva(dev, "script-src")).toContain("'unsafe-eval'")
    expect(directiva(dev, "connect-src")).toContain("ws:")
  })

  it("report-uri sólo si está CSP_REPORT_URI", () => {
    expect(politicaCsp({})).not.toContain("report-uri")
    expect(politicaCsp({ CSP_REPORT_URI: " https://reportes.example/csp " })).toMatch(/; report-uri https:\/\/reportes\.example\/csp$/)
  })

  it("correo: img-src https: sólo con la opción (el iframe srcdoc hereda la CSP)", () => {
    expect(directiva(politicaCsp({}), "img-src")).not.toMatch(/ https:(?: |$)/)
    const correo = politicaCsp({}, { correo: true })
    expect(directiva(correo, "img-src")).toMatch(/ https:(?: |$)/)
    // El resto no se abre.
    expect(directiva(correo, "script-src")).toBe("script-src 'self' 'unsafe-inline'")
    expect(directiva(correo, "connect-src")).not.toMatch(/ https:(?: |$)/)
  })

  it("sin duplicados aunque dos variables apunten al mismo origen", () => {
    const csp = politicaCsp({ R2_SHOP_MEDIA_PUBLIC_URL: "https://fotos.plataforma.example" }, { correo: true })
    expect(csp.match(/https:\/\/fotos\.plataforma\.example/g)).toHaveLength(1)
    for (const parte of csp.split("; ")) {
      const valores = parte.split(" ").slice(1)
      expect(new Set(valores).size).toBe(valores.length)
    }
  })
})
