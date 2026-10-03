import { describe, expect, it } from "vitest"
import { prepararCuerpo } from "./correo-html"
import { armarSrcdoc } from "./correo-srcdoc"

const sane = (html: string) => prepararCuerpo({ html, texto: null }).html

describe("prepararCuerpo: saneado del HTML entrante", () => {
  it("quita script, handlers on*, iframe, form, object, embed y style externo", () => {
    const out = sane(
      `<p onclick="x()">Hola</p><script>alert(1)</script><img src="data:image/png;base64,AAAA" onerror="alert(1)">` +
        `<iframe src="https://malo.example"></iframe><form action="https://malo.example"><input></form>` +
        `<object data="x"></object><embed src="x"><link rel="stylesheet" href="https://malo.example/a.css"><style>@import url(https://malo.example/a.css)</style>`,
    )
    expect(out).toContain("Hola")
    expect(out).not.toMatch(/<script|onclick|onerror|<iframe|<form|<input|<object|<embed|<link|<style|alert\(1\)|@import/i)
  })

  it("los enlaces abren en pestaña nueva con rel seguro y solo con esquemas permitidos", () => {
    const out = sane(`<a href="https://cliente.example/x">ok</a><a href="javascript:alert(1)">mal</a><a href="mailto:a@cliente.example">m</a>`)
    expect(out).toContain('href="https://cliente.example/x"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer nofollow"')
    expect(out).not.toContain("javascript:")
    expect(out).toContain('href="mailto:a@cliente.example"')
  })

  it("las imágenes remotas http(s) pasan a data-src (bloqueadas) y se cuentan", () => {
    const r = prepararCuerpo({ html: `<img src="https://pixel.example/p.gif"><img src="http://x.example/a.png" alt="a">`, texto: null })
    expect(r.html).not.toMatch(/ src="https?:/)
    expect(r.html).toContain('data-src="https://pixel.example/p.gif"')
    expect(r.imagenesRemotas).toBe(2)
  })

  it("las imágenes data: quedan en línea y no cuentan como remotas", () => {
    const r = prepararCuerpo({ html: `<img src="data:image/png;base64,AAAA">`, texto: null })
    expect(r.html).toContain('src="data:image/png;base64,AAAA"')
    expect(r.imagenesRemotas).toBe(0)
  })

  it("descarta cid: y otros esquemas en img, y neutraliza url() remotas en estilos en línea", () => {
    const r = prepararCuerpo({
      html: `<img src="cid:abc"><div style="color:red;background-image:url(https://pixel.example/p.gif)">x</div><img src="javascript:alert(1)">`,
      texto: null,
    })
    expect(r.html).not.toMatch(/cid:|javascript:|pixel\.example/)
    expect(r.html).toContain("color:red")
  })

  it("sin html usa <pre> con el texto escapado", () => {
    const r = prepararCuerpo({ html: null, texto: "Hola <b>x</b> & chau" })
    expect(r.html).toContain("<pre")
    expect(r.html).toContain("Hola &lt;b&gt;x&lt;/b&gt; &amp; chau")
    expect(r.html).not.toContain("<b>")
  })

  it("sin html ni texto devuelve vacío", () => {
    expect(prepararCuerpo({ html: null, texto: null }).html).toBe("")
  })
})

describe("armarSrcdoc", () => {
  it("por defecto: CSP default-src 'none' con img-src data: y sin imágenes remotas", () => {
    const doc = armarSrcdoc(`<img data-src="https://pixel.example/p.gif"><p>x</p>`, false)
    expect(doc).toContain(`default-src 'none'`)
    expect(doc).toContain("img-src data:")
    expect(doc).not.toContain("img-src data: https:")
    expect(doc).not.toMatch(/ src="https:/)
  })

  it("mostrar imágenes: restaura src y habilita img-src https:", () => {
    const doc = armarSrcdoc(`<img data-src="https://pixel.example/p.gif">`, true)
    expect(doc).toContain(' src="https://pixel.example/p.gif"')
    expect(doc).toContain("img-src https: data:")
  })

  it("no permite scripts ni conexiones (sin script-src ni connect-src abiertos)", () => {
    const doc = armarSrcdoc("<p>x</p>", true)
    expect(doc).not.toMatch(/script-src|connect-src|frame-src/)
    expect(doc).toContain("<base target=\"_blank\">")
  })
})
