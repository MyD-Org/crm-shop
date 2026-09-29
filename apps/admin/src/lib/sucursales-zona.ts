/**
 * Zona y asignación de sucursal: COPIA en el CRM de `apps/clientes/src/lib/sucursales.ts` (change
 * `sucursales-igz-mdp`, rebanada A; no hay workspaces). Las dos ejecutan el MISMO fixture
 * (`__fixtures__/sucursales-casos.json`, idéntico byte a byte: lo vigila `sucursales-zona.test.ts`).
 * Si cambia una, cambia la otra.
 *
 * Puro a propósito: sin DB, reloj ni Next. Acá sirve para interpretar la regla congelada en
 * `orders.sucursal_regla` y para reproducir la asignación en tests.
 */

/** Las 24 jurisdicciones (misma lista que `apps/clientes/src/lib/provincias.ts`). */
const PROVINCIAS_AR = [
  "Buenos Aires",
  "Catamarca",
  "Chaco",
  "Chubut",
  "Ciudad Autónoma de Buenos Aires",
  "Córdoba",
  "Corrientes",
  "Entre Ríos",
  "Formosa",
  "Jujuy",
  "La Pampa",
  "La Rioja",
  "Mendoza",
  "Misiones",
  "Neuquén",
  "Río Negro",
  "Salta",
  "San Juan",
  "San Luis",
  "Santa Cruz",
  "Santa Fe",
  "Santiago del Estero",
  "Tierra del Fuego",
  "Tucumán",
] as const

type ProvinciaAR = (typeof PROVINCIAS_AR)[number]

function clave(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^provincia\s+de\s+/, "")
    .replace(/[^a-z0-9]/g, "")
}

const ALIAS: Record<string, ProvinciaAR> = {
  caba: "Ciudad Autónoma de Buenos Aires",
  capitalfederal: "Ciudad Autónoma de Buenos Aires",
  ciudaddebuenosaires: "Ciudad Autónoma de Buenos Aires",
  tierradelfuegoantartidaeislasdelatlanticosur: "Tierra del Fuego",
}

const POR_CLAVE = new Map<string, ProvinciaAR>(PROVINCIAS_AR.map((p) => [clave(p), p]))

function provinciaCanonicaZona(v: string | null | undefined): ProvinciaAR | null {
  if (!v) return null
  const k = clave(v.trim())
  if (!k) return null
  return POR_CLAVE.get(k) ?? ALIAS[k] ?? null
}

/** Compara textos sin acentos, mayúsculas, espacios ni signos. */
function claveTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
}

/** Clave de zona de una provincia tal como llega. Un texto que no es una jurisdicción da "". */
export function claveProvinciaZona(provincia: string | null | undefined): string {
  const canonica = provinciaCanonicaZona(provincia)
  return canonica ? claveTexto(canonica) : ""
}

/** Lo que estas funciones necesitan de una sucursal. */
export interface SucursalDato {
  slug: string
  aceptaRetiro: boolean
  aceptaEnvio: boolean
  /** Vacía = toda la zona; con ciudades = sólo esas. */
  envioCiudades: string[]
  orden: number
  activa: boolean
  predeterminada: boolean
}

/** Lo que necesitan de una zona. */
export interface ZonaDato {
  id: string
  provinciaClave: string
  sucursal: string
  facturaSucursal: string | null
}

export type MotivoRegla = "zona" | "predeterminada" | "fallback_inactiva" | "retiro_local"

/** La regla aplicada, tal como se congela en `orders.sucursal_regla` (`v` versiona la forma). */
export interface ReglaAplicada {
  v: 1
  /** Identificador legible: `zona:misiones`, `zona:default`, `zona:fallback_inactiva`, `retiro:<slug>`. */
  regla: string
  motivo: MotivoRegla
  /** Clave de la provincia evaluada; null en el retiro (no depende de la zona). */
  provincia: string | null
  zonaId: string | null
  /** Sucursal que dicta la zona (en el retiro, la del local elegido). */
  sucursalZona: string
  /** Cuenta que factura si la zona lo fuerza; null = la de despacho. */
  facturaSucursal: string | null
  /** Líneas que se traen de otra sucursal (rebanada B); vacío en la A. */
  lineasATraer: string[]
}

export interface ResolucionZona {
  sucursal: string
  zonaId: string | null
  motivo: Exclude<MotivoRegla, "retiro_local">
  regla: string
}

export type ErrorSucursal = "sin_sucursal_activa" | "sin_retiro" | "sin_envio"

const activas = (sucursales: SucursalDato[]) =>
  sucursales.filter((s) => s.activa).sort((a, b) => a.orden - b.orden || a.slug.localeCompare(b.slug))

function sucursalDeRespaldo(sucursales: SucursalDato[]): SucursalDato | null {
  const vivas = activas(sucursales)
  return vivas.find((s) => s.predeterminada) ?? vivas[0] ?? null
}

export function resolverZona(
  provincia: string | null | undefined,
  zonas: ZonaDato[],
  sucursales: SucursalDato[],
): ResolucionZona | { error: "sin_sucursal_activa" } {
  const k = claveProvinciaZona(provincia)
  const zona = k ? zonas.find((z) => z.provinciaClave === k) : undefined

  if (zona) {
    const destino = sucursales.find((s) => s.slug === zona.sucursal)
    if (destino?.activa) {
      return { sucursal: destino.slug, zonaId: zona.id, motivo: "zona", regla: `zona:${k}` }
    }
    const respaldo = sucursalDeRespaldo(sucursales)
    if (!respaldo) return { error: "sin_sucursal_activa" }
    return {
      sucursal: respaldo.slug,
      zonaId: zona.id,
      motivo: "fallback_inactiva",
      regla: "zona:fallback_inactiva",
    }
  }

  const predeterminada = sucursalDeRespaldo(sucursales)
  if (!predeterminada) return { error: "sin_sucursal_activa" }
  const esLaPredeterminada = predeterminada.predeterminada
  return {
    sucursal: predeterminada.slug,
    zonaId: null,
    motivo: esLaPredeterminada ? "predeterminada" : "fallback_inactiva",
    regla: esLaPredeterminada ? "zona:default" : "zona:fallback_inactiva",
  }
}

export interface EntradaAsignacion {
  entregaTipo: "retiro" | "envio"
  /** Provincia de entrega (envío). Se normaliza; el retiro la ignora. */
  provincia?: string | null
  /** Ciudad de entrega (envío): se valida contra `envioCiudades` de la sucursal si tiene lista. */
  ciudad?: string | null
  /** Slug del local elegido (retiro). */
  sucursalRetiro?: string | null
}

export interface Asignacion {
  sucursal: string
  regla: ReglaAplicada
}

export function asignarSucursal(
  entrada: EntradaAsignacion,
  datos: { sucursales: SucursalDato[]; zonas: ZonaDato[] },
): Asignacion | { error: ErrorSucursal } {
  const { sucursales, zonas } = datos

  if (entrada.entregaTipo === "retiro") {
    const local = sucursales.find((s) => s.slug === entrada.sucursalRetiro)
    if (!local || !local.activa || !local.aceptaRetiro) return { error: "sin_retiro" }
    return {
      sucursal: local.slug,
      regla: {
        v: 1,
        regla: `retiro:${local.slug}`,
        motivo: "retiro_local",
        provincia: null,
        zonaId: null,
        sucursalZona: local.slug,
        facturaSucursal: null,
        lineasATraer: [],
      },
    }
  }

  const zona = resolverZona(entrada.provincia, zonas, sucursales)
  if ("error" in zona) return zona
  const destino = sucursales.find((s) => s.slug === zona.sucursal)
  if (!destino || !destino.aceptaEnvio) return { error: "sin_envio" }
  if (destino.envioCiudades.length > 0) {
    const ciudad = entrada.ciudad ? claveTexto(entrada.ciudad) : ""
    if (!ciudad || !destino.envioCiudades.some((c) => claveTexto(c) === ciudad)) {
      return { error: "sin_envio" }
    }
  }
  const zonaFila = zona.zonaId ? zonas.find((z) => z.id === zona.zonaId) : undefined
  return {
    sucursal: destino.slug,
    regla: {
      v: 1,
      regla: zona.regla,
      motivo: zona.motivo,
      provincia: claveProvinciaZona(entrada.provincia) || null,
      zonaId: zona.zonaId,
      sucursalZona: destino.slug,
      facturaSucursal: zonaFila?.facturaSucursal ?? null,
      lineasATraer: [],
    },
  }
}
