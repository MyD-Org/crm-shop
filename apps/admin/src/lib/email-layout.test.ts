import { describe, expect, it } from "vitest"
import { emailCardHtml, emailDocumentHtml, oneLine, safeLogoUrl, saludo } from "@/lib/email-layout"

describe("oneLine", () => {
  it("CR/LF y controles se convierten en un espacio", () => {
    expect(oneLine("Tienda\r\nBcc: x@cliente.example")).toBe("Tienda Bcc: x@cliente.example")
  })

  it("recorta espacios de los extremos y colapsa los del medio", () => {
    expect(oneLine("  Ana   Pérez  ")).toBe("Ana Pérez")
  })
})

describe("saludo", () => {
  it("con nombre: 'Hola, {nombre}:'", () => {
    expect(saludo("Ana")).toBe("Hola, Ana:")
  })

  it("sin nombre: 'Hola:'", () => {
    expect(saludo("   ")).toBe("Hola:")
  })
})

describe("safeLogoUrl", () => {
  it("acepta una URL absoluta a .png", () => {
    expect(safeLogoUrl("https://cdn.cliente.example/logo.png")).toBe("https://cdn.cliente.example/logo.png")
  })

  it("acepta .jpg y .jpeg sin importar mayúsculas", () => {
    expect(safeLogoUrl("https://cdn.cliente.example/logo.JPG")).toBe("https://cdn.cliente.example/logo.JPG")
    expect(safeLogoUrl("http://cdn.cliente.example/logo.jpeg")).toBe("http://cdn.cliente.example/logo.jpeg")
  })

  it("rechaza rutas relativas (el default de todo tenant hoy)", () => {
    expect(safeLogoUrl("/logos/central-led.svg")).toBeNull()
  })

  it("rechaza SVG y WebP aunque sean absolutas", () => {
    expect(safeLogoUrl("https://cdn.cliente.example/logo.svg")).toBeNull()
    expect(safeLogoUrl("https://cdn.cliente.example/logo.webp")).toBeNull()
  })

  it("rechaza esquemas que no son http/https", () => {
    expect(safeLogoUrl("data:image/png;base64,AAAA")).toBeNull()
    expect(safeLogoUrl("javascript:alert(1)")).toBeNull()
  })

  it("null/undefined/vacío ⇒ null", () => {
    expect(safeLogoUrl(null)).toBeNull()
    expect(safeLogoUrl(undefined)).toBeNull()
    expect(safeLogoUrl("")).toBeNull()
  })
})

describe("emailCardHtml", () => {
  it("escapa tenantName, título, párrafos y pie", () => {
    const html = emailCardHtml({
      tenantName: "Tienda <Demo>",
      titulo: "Título <b>",
      parrafos: ["Hola <script>"],
      pie: "Pie & co",
    })
    expect(html).toContain("Tienda &lt;Demo&gt;")
    expect(html).toContain("Título &lt;b&gt;")
    expect(html).toContain("Hola &lt;script&gt;")
    expect(html).toContain("Pie &amp; co")
    expect(html).not.toContain("<script>")
  })

  it("sin logoUrl muestra el nombre del tenant en texto", () => {
    const html = emailCardHtml({ tenantName: "Empresa Demo" })
    expect(html).toContain("Empresa Demo")
    expect(html).not.toContain("<img")
  })

  it("con logoUrl muestra un <img> en vez del texto", () => {
    const html = emailCardHtml({ tenantName: "Empresa Demo", logoUrl: "https://cdn.cliente.example/logo.png" })
    expect(html).toContain('<img src="https://cdn.cliente.example/logo.png" alt="Empresa Demo"')
  })

  it("preheader: div invisible, escapado, antes del cuerpo visible", () => {
    const html = emailCardHtml({ tenantName: "Empresa Demo", preheader: "Preview <raro>" })
    expect(html).toContain("Preview &lt;raro&gt;")
    expect(html).toContain("display:none")
    expect(html.indexOf("display:none")).toBeLessThan(html.indexOf("Empresa Demo"))
  })

  it("sin preheader no agrega el div invisible", () => {
    const html = emailCardHtml({ tenantName: "Empresa Demo" })
    expect(html).not.toContain("display:none")
  })

  it("boton: href y texto escapados", () => {
    const html = emailCardHtml({ tenantName: "Empresa Demo", boton: { url: "https://x.example/?a=1&b=2", texto: "Ver <más>" } })
    expect(html).toContain('href="https://x.example/?a=1&amp;b=2"')
    expect(html).toContain("Ver &lt;más&gt;")
  })

  it("sin boton no hay <a>", () => {
    const html = emailCardHtml({ tenantName: "Empresa Demo" })
    expect(html).not.toContain("<a ")
  })

  it("contenidoHtml se inserta tal cual, sin escapar", () => {
    const html = emailCardHtml({ tenantName: "Empresa Demo", contenidoHtml: "<table><tr><td>x</td></tr></table>" })
    expect(html).toContain("<table><tr><td>x</td></tr></table>")
  })

  it("footerExterno: texto escapado, fuera de la tarjeta blanca", () => {
    const html = emailCardHtml({ tenantName: "Empresa Demo", footerExterno: "Portal de <clientes>" })
    expect(html).toContain("Portal de &lt;clientes&gt;")
  })

  it("sin título no agrega el párrafo de título", () => {
    const html = emailCardHtml({ tenantName: "Empresa Demo", parrafos: ["Cuerpo"] })
    expect(html).not.toContain("font-weight:700")
  })
})

describe("emailDocumentHtml", () => {
  it("envuelve en un documento completo con charset y color-scheme fijos en claro", () => {
    const doc = emailDocumentHtml("<p>hola</p>", "Asunto <raro>")
    expect(doc).toContain("<!doctype html>")
    expect(doc).toContain('<meta charset="utf-8">')
    expect(doc).toContain('<meta name="color-scheme" content="light">')
    expect(doc).toContain('<meta name="supported-color-schemes" content="light">')
    expect(doc).toContain("<title>Asunto &lt;raro&gt;</title>")
    expect(doc).toContain("<p>hola</p>")
  })

  it("sin título no agrega <title>", () => {
    const doc = emailDocumentHtml("<p>hola</p>")
    expect(doc).not.toContain("<title>")
  })
})
