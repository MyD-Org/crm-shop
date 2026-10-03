import sanitizeHtml from "sanitize-html"

// Saneado en el SERVIDOR del HTML de los correos entrantes (nunca confiar en el cliente).
// Lista blanca de etiquetas y atributos; sin script/iframe/form/object/embed/link/style de
// bloque; enlaces con target=_blank y rel seguro; imágenes http(s) reescritas a `data-src`
// (bloqueadas por defecto, ver correo-srcdoc.ts); `data:` queda en línea. Los estilos en línea
// pasan solo con propiedades conocidas y sin url()/expression.

const SEGURO = /^(?!.*(url\s*\(|expression|javascript:|@import|behavior|-moz-binding)).*$/i
const PROPIEDADES_ESTILO = [
  "color", "background", "background-color", "font", "font-size", "font-family", "font-weight", "font-style",
  "text-align", "text-decoration", "line-height", "letter-spacing", "white-space", "vertical-align",
  "width", "height", "max-width", "min-width", "max-height", "min-height",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border", "border-top", "border-right", "border-bottom", "border-left", "border-collapse", "border-spacing", "border-color", "border-style", "border-width", "border-radius",
  "display", "list-style", "list-style-type", "table-layout", "word-break", "overflow-wrap",
]

const ESTILOS: Record<string, RegExp[]> = Object.fromEntries(PROPIEDADES_ESTILO.map((p) => [p, [SEGURO]]))

const OPCIONES: sanitizeHtml.IOptions = {
  allowedTags: [
    "a", "abbr", "b", "blockquote", "br", "caption", "center", "cite", "code", "col", "colgroup", "dd", "div", "dl", "dt",
    "em", "font", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre", "s", "small", "span",
    "strike", "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
  ],
  allowedAttributes: {
    "*": ["style", "align", "valign", "dir", "width", "height", "bgcolor", "colspan", "rowspan", "color", "face", "size"],
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "width", "height", "data-src"],
  },
  allowedStyles: { "*": ESTILOS },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["data"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  // Contenido de estas etiquetas se descarta entero (no queda texto de script/style).
  nonTextTags: ["script", "style", "textarea", "option", "noscript"],
  transformTags: {
    a: (_tag, attribs) => ({
      tagName: "a",
      attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" },
    }),
    img: (_tag, attribs) => {
      const { src, ...resto } = attribs
      if (typeof src === "string" && /^\s*https?:\/\//i.test(src)) {
        return { tagName: "img", attribs: { ...resto, "data-src": src.trim() } }
      }
      // data: se valida por esquema más abajo; cualquier otra cosa (cid:, javascript:) se descarta.
      const { "data-src": _ignorado, ...limpio } = resto
      void _ignorado
      return { tagName: "img", attribs: src ? { ...limpio, src } : limpio }
    },
  },
}

export interface CuerpoPreparado {
  /** HTML saneado listo para el iframe (imágenes remotas en `data-src`), o "" si no hay cuerpo. */
  html: string
  /** Cantidad de imágenes remotas bloqueadas: decide si se ofrece "Mostrar imágenes". */
  imagenesRemotas: number
}

const escapar = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export function prepararCuerpo(entrada: { html: string | null; texto: string | null }): CuerpoPreparado {
  if (entrada.html) {
    const html = sanitizeHtml(entrada.html, OPCIONES)
    const imagenesRemotas = (html.match(/ data-src="https?:/g) ?? []).length
    return { html, imagenesRemotas }
  }
  if (entrada.texto) return { html: `<pre>${escapar(entrada.texto)}</pre>`, imagenesRemotas: 0 }
  return { html: "", imagenesRemotas: 0 }
}
