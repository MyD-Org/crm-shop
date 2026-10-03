// Documento que se muestra en el iframe sandbox de un correo. Lógica pura y sin dependencias
// (se usa también en el cliente): recibe HTML ya saneado en el servidor (correo-html.ts), donde
// las imágenes remotas llegan como `data-src`.
//
// Defensa en profundidad: sanitize-html en el servidor + iframe sandbox sin scripts ni mismo
// origen + CSP `default-src 'none'`. Por defecto no se carga ninguna imagen remota (evita
// pixeles de seguimiento); "Mostrar imágenes" restaura `src` y abre `img-src https:`.

const ESTILO_BASE =
  "body{margin:0;padding:12px;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;background:#fff;overflow-wrap:anywhere}" +
  "img{max-width:100%;height:auto}pre{white-space:pre-wrap;font:inherit;margin:0}a{color:#1a56db}table{max-width:100%}blockquote{margin:0 0 0 8px;padding-left:8px;border-left:3px solid #ddd;color:#555}"

export function armarSrcdoc(htmlSaneado: string, mostrarImagenes: boolean): string {
  const cuerpo = mostrarImagenes ? htmlSaneado.replace(/ data-src="/g, ' src="') : htmlSaneado
  const imgSrc = mostrarImagenes ? "img-src https: data:" : "img-src data:"
  const csp = `default-src 'none'; style-src 'unsafe-inline'; ${imgSrc}`
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<base target="_blank"><style>${ESTILO_BASE}</style></head><body>${cuerpo}</body></html>`
  )
}
