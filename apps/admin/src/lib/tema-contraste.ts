// Contraste WCAG 2.x de la paleta que elige cada empresa para su tienda (tenants.shop_tema).
// Puro y sin dependencias: lo usa la ruta PUT de Tienda online para rechazar paletas ilegibles.
// El Shop (rebanada 4b) trae una copia con el mismo fixture de casos (tema-contrato.json).
//
// Los pares que se validan son los que el Shop pinta con texto real:
//   - text sobre bg                  (cuerpo de la página)
//   - onPrimary sobre primary        (botones y barras)
//   - accent sobre surface           (enlaces, etiquetas, precios)
//   - marca-sobre-oscuro sobre surfaceDark (acento del pie de página). Ese color NO lo elige la
//     empresa: se deriva del acento mezclándolo con blanco (MEZCLA_MARCA_SOBRE_OSCURO), con la
//     misma cuenta que usa el Shop: color-mix(in srgb, <accent> 65%, white).

import type { ColoresTema, ColorTema } from "./tienda-online"

/** AA para texto normal. */
export const UMBRAL_CONTRASTE = 4.5

/** Parte de blanco que se le mezcla al acento para leerse sobre el pie oscuro. */
export const MEZCLA_MARCA_SOBRE_OSCURO = 0.35

function canales(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function luminancia(hex: string): number {
  const [r, g, b] = canales(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Razón de contraste WCAG entre dos colores `#rrggbb` (1 a 21). */
export function razonDeContraste(a: string, b: string): number {
  const la = luminancia(a)
  const lb = luminancia(b)
  const [claro, oscuro] = la >= lb ? [la, lb] : [lb, la]
  return (claro + 0.05) / (oscuro + 0.05)
}

/** Acento aclarado para leerse sobre el pie oscuro: mezcla lineal en sRGB con blanco. */
export function marcaSobreOscuro(accent: string): string {
  const mezclado = canales(accent).map((c) => Math.round(c + (255 - c) * MEZCLA_MARCA_SOBRE_OSCURO))
  return `#${mezclado.map((c) => c.toString(16).padStart(2, "0")).join("")}`
}

export interface ParContraste {
  /** Color de la paleta al que se le atribuye el problema si el par no alcanza. */
  campo: ColorTema
  razon: number
  /** Qué se lee sobre qué, en palabras de la pantalla. */
  descripcion: string
}

export function contrasteTema(c: ColoresTema): ParContraste[] {
  return [
    { campo: "text", razon: razonDeContraste(c.text, c.bg), descripcion: "El texto sobre el fondo" },
    { campo: "onPrimary", razon: razonDeContraste(c.onPrimary, c.primary), descripcion: "El texto sobre el color principal" },
    { campo: "accent", razon: razonDeContraste(c.accent, c.surface), descripcion: "El color de acento sobre las tarjetas" },
    {
      campo: "surfaceDark",
      razon: razonDeContraste(marcaSobreOscuro(c.accent), c.surfaceDark),
      descripcion: "El color de acento aclarado sobre el pie de página",
    },
  ]
}

export type ResultadoContraste = { ok: true } | { ok: false; campo: ColorTema; razon: number; error: string }

/** Primer par que no alcanza el mínimo, con un error en usted. */
export function validarContrasteTema(c: ColoresTema): ResultadoContraste {
  for (const par of contrasteTema(c)) {
    if (par.razon < UMBRAL_CONTRASTE) {
      const razon = Math.round(par.razon * 100) / 100
      return {
        ok: false,
        campo: par.campo,
        razon: par.razon,
        error: `${par.descripcion} no se lee con comodidad (contraste ${String(razon).replace(".", ",")}:1, el mínimo es ${String(UMBRAL_CONTRASTE).replace(".", ",")}:1). Elija colores más distantes en claridad.`,
      }
    }
  }
  return { ok: true }
}
