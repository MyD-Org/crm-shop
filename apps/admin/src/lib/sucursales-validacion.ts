import { provinciaCanonica } from "@/lib/provincias"

// Validación pura de sucursales y zonas (sin DB, sin Next): la comparten la API y el formulario
// del backoffice, así el mensaje que ve el operador es el mismo en los dos lados. Textos en usted.

export const SLUG_RE = /^[a-z0-9-]{2,20}$/
// `zonas` es un segmento estático de la API (/api/admin/sucursales/zonas): un slug igual
// quedaría inalcanzable.
export const SLUGS_RESERVADOS = ["zonas"]

const WHATSAPP_RE = /^\+?[0-9 ()-]{6,24}$/
export const MAX_CIUDADES = 50

export type Invalido = { ok: false; campo: string; error: string }

export interface SucursalValida {
  slug: string
  nombre: string
  direccion: string
  ciudad: string
  provincia: string
  whatsapp: string
  aceptaRetiro: boolean
  aceptaEnvio: boolean
  envioCiudades: string[]
  orden: number
  activa: boolean
  predeterminada: boolean
  maestra: boolean
}

export type CambiosSucursal = Partial<Omit<SucursalValida, "slug">>

const invalido = (campo: string, error: string): Invalido => ({ ok: false, campo, error })

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

function texto(
  body: Record<string, unknown>,
  campo: string,
  etiqueta: string,
  opts: { requerido?: boolean; max: number },
): { ok: true; valor: string | undefined } | Invalido {
  const v = body[campo]
  if (v === undefined) return { ok: true, valor: undefined }
  if (typeof v !== "string") return invalido(campo, `${etiqueta} no es válido.`)
  const limpio = v.trim()
  if (opts.requerido && limpio === "") return invalido(campo, `Ingrese ${etiqueta.toLowerCase()}.`)
  if (limpio.length > opts.max) return invalido(campo, `${etiqueta} admite hasta ${opts.max} caracteres.`)
  return { ok: true, valor: limpio }
}

function booleano(body: Record<string, unknown>, campo: string): { ok: true; valor: boolean | undefined } | Invalido {
  const v = body[campo]
  if (v === undefined) return { ok: true, valor: undefined }
  if (typeof v !== "boolean") return invalido(campo, "El valor indicado no es válido.")
  return { ok: true, valor: v }
}

/** Valida el slug: 2 a 20 caracteres, minúsculas, números y guiones. */
export function validarSlug(slug: unknown): { ok: true; slug: string } | Invalido {
  if (typeof slug !== "string" || slug.trim() === "") return invalido("slug", "Ingrese un identificador para la sucursal.")
  const s = slug.trim()
  if (!SLUG_RE.test(s) || SLUGS_RESERVADOS.includes(s)) {
    return invalido("slug", "El identificador debe tener entre 2 y 20 caracteres: minúsculas, números o guiones.")
  }
  return { ok: true, slug: s }
}

/**
 * Valida los campos presentes de una sucursal (alta o cambio parcial). Los campos ausentes no
 * se validan ni se devuelven; para el alta, `validarSucursalNueva` exige los obligatorios.
 */
function validarCampos(body: Record<string, unknown>): { ok: true; cambios: CambiosSucursal } | Invalido {
  const cambios: CambiosSucursal = {}

  const nombre = texto(body, "nombre", "El nombre", { requerido: true, max: 80 })
  if (!nombre.ok) return nombre
  if (nombre.valor !== undefined) cambios.nombre = nombre.valor

  for (const [campo, etiqueta, max] of [
    ["direccion", "La dirección", 200],
    ["ciudad", "La ciudad", 100],
  ] as const) {
    const t = texto(body, campo, etiqueta, { max })
    if (!t.ok) return t
    if (t.valor !== undefined) cambios[campo] = t.valor
  }

  if (body.provincia !== undefined) {
    if (typeof body.provincia !== "string") return invalido("provincia", "La provincia no es válida.")
    if (body.provincia.trim() === "") cambios.provincia = ""
    else {
      const p = provinciaCanonica(body.provincia)
      if (!p) return invalido("provincia", "Seleccione una provincia de la lista.")
      cambios.provincia = p.nombre
    }
  }

  const wa = texto(body, "whatsapp", "El WhatsApp", { max: 24 })
  if (!wa.ok) return wa
  if (wa.valor !== undefined) {
    if (wa.valor !== "" && !WHATSAPP_RE.test(wa.valor)) {
      return invalido("whatsapp", "Ingrese un WhatsApp válido: solo números, con código de país y de área.")
    }
    cambios.whatsapp = wa.valor
  }

  for (const campo of ["aceptaRetiro", "aceptaEnvio", "activa", "predeterminada", "maestra"] as const) {
    const b = booleano(body, campo)
    if (!b.ok) return b
    if (b.valor !== undefined) cambios[campo] = b.valor
  }

  if (body.envioCiudades !== undefined) {
    const c = body.envioCiudades
    if (!Array.isArray(c) || c.length > MAX_CIUDADES || c.some((x) => typeof x !== "string" || x.length > 80)) {
      return invalido("envioCiudades", "Ingrese las ciudades de envío como una lista de nombres.")
    }
    const vistas = new Set<string>()
    const limpias: string[] = []
    for (const x of c as string[]) {
      const n = x.trim()
      const k = n.toLowerCase()
      if (n !== "" && !vistas.has(k)) {
        vistas.add(k)
        limpias.push(n)
      }
    }
    cambios.envioCiudades = limpias
  }

  if (body.orden !== undefined) {
    const o = body.orden
    if (typeof o !== "number" || !Number.isInteger(o) || o < 0 || o > 9999) {
      return invalido("orden", "Ingrese un número entero igual o mayor que cero.")
    }
    cambios.orden = o
  }

  return { ok: true, cambios }
}

export function validarSucursalNueva(body: unknown): { ok: true; valor: SucursalValida } | Invalido {
  if (!esObjeto(body)) return invalido("body", "Los datos enviados no son válidos.")
  const slug = validarSlug(body.slug)
  if (!slug.ok) return slug
  if (typeof body.nombre !== "string" || body.nombre.trim() === "") return invalido("nombre", "Ingrese el nombre de la sucursal.")
  const c = validarCampos(body)
  if (!c.ok) return c
  const x = c.cambios
  return {
    ok: true,
    valor: {
      slug: slug.slug,
      nombre: x.nombre ?? "",
      direccion: x.direccion ?? "",
      ciudad: x.ciudad ?? "",
      provincia: x.provincia ?? "",
      whatsapp: x.whatsapp ?? "",
      aceptaRetiro: x.aceptaRetiro ?? true,
      aceptaEnvio: x.aceptaEnvio ?? true,
      envioCiudades: x.envioCiudades ?? [],
      orden: x.orden ?? 0,
      activa: x.activa ?? true,
      predeterminada: x.predeterminada ?? false,
      maestra: x.maestra ?? false,
    },
  }
}

/** Cambio parcial: el slug NO se puede modificar (lo guardan los pedidos como texto). */
export function validarSucursalCambios(body: unknown): { ok: true; cambios: CambiosSucursal } | Invalido {
  if (!esObjeto(body)) return invalido("body", "Los datos enviados no son válidos.")
  if (body.slug !== undefined) return invalido("slug", "El identificador de una sucursal no se puede modificar.")
  const c = validarCampos(body)
  if (!c.ok) return c
  if (Object.keys(c.cambios).length === 0) return invalido("body", "No hay cambios para guardar.")
  return c
}

export interface ZonaValida {
  provinciaClave: string
  provincia: string
  sucursal: string
  facturaSucursal: string | null
}

/** Zona provincia -> sucursal. Ambas sucursales se verifican contra la DB en el repo. */
export function validarZona(body: unknown): { ok: true; valor: ZonaValida } | Invalido {
  if (!esObjeto(body)) return invalido("body", "Los datos enviados no son válidos.")
  const prov = provinciaCanonica(typeof body.provincia === "string" ? body.provincia : null)
  if (!prov) return invalido("provincia", "Seleccione una provincia de la lista.")
  if (typeof body.sucursal !== "string" || body.sucursal.trim() === "") {
    return invalido("sucursal", "Seleccione una sucursal.")
  }
  let facturaSucursal: string | null = null
  if (body.facturaSucursal !== undefined && body.facturaSucursal !== null && body.facturaSucursal !== "") {
    if (typeof body.facturaSucursal !== "string") return invalido("facturaSucursal", "Seleccione una sucursal válida.")
    facturaSucursal = body.facturaSucursal.trim()
  }
  return {
    ok: true,
    valor: { provinciaClave: prov.clave, provincia: prov.nombre, sucursal: body.sucursal.trim(), facturaSucursal },
  }
}
