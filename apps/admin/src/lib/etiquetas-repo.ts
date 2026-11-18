import { listarMarcas, type MarcaDto } from "@/lib/precios-online-repo"
import { extrasPublicos, urlPublicaShopDeTenant, type EnvShop } from "@/lib/shop-destino"
import { listarSucursales } from "@/lib/sucursales-repo"
import { getTenantByIdFromDb } from "@/lib/tenants"

// Datos que necesita la pantalla de etiquetas (/admin/etiquetas). El servidor no arma TSPL ni toca
// la impresora: sólo entrega lo del tenant de la sesión. Siempre recibe el tenant del guard.

export interface SucursalEtiquetas {
  slug: string
  nombre: string
  direccion: string
  ciudad: string
  whatsapp: string
  activa: boolean
}

/** Tienda a la que puede llevar el QR: la principal (`shop_url`) o un destino extra. */
export interface TiendaEtiquetas {
  /** Nombre para mostrar: el del tenant (principal) o `marca.nombre` del extra; "" = sólo el host. */
  etiqueta: string
  /** Origin público, sin barra final. */
  url: string
}

export interface ContextoEtiquetas {
  tenant: {
    nombre: string
    /** Rubro por defecto de la etiqueta de tienda (`tenants.subtitle`). */
    rubro: string
    logoPath: string
    /** URL pública del Shop del tenant; null = sin tienda (no se pueden armar QR). */
    shopUrl: string | null
  }
  /** Tiendas para elegir el destino del QR: la principal primero; vacío si no hay principal. */
  tiendas: TiendaEtiquetas[]
  sucursales: SucursalEtiquetas[]
  /** Marcas del catálogo (`clave` normalizada para el filtro del listado, `nombre` para mostrar). */
  marcas: MarcaDto[]
}

export async function armarContexto(tenantId: string, env: EnvShop): Promise<ContextoEtiquetas> {
  const [tenant, sucursales, marcas] = await Promise.all([
    getTenantByIdFromDb(tenantId),
    listarSucursales(tenantId),
    listarMarcas(tenantId),
  ])
  const shopUrl = tenant ? urlPublicaShopDeTenant(tenant, env) : null
  const tiendas: TiendaEtiquetas[] = []
  if (tenant && shopUrl) {
    tiendas.push({ etiqueta: tenant.name, url: shopUrl })
    for (const e of extrasPublicos(tenant)) {
      if (!tiendas.some((t) => t.url === e.url)) tiendas.push({ etiqueta: nombreDeMarca(e.marca), url: e.url })
    }
  }
  return {
    tenant: {
      nombre: tenant?.name ?? "",
      rubro: tenant?.subtitle ?? "",
      logoPath: tenant?.logoPath ?? "",
      shopUrl,
    },
    tiendas,
    sucursales: sucursales.map((s) => ({
      slug: s.slug,
      nombre: s.nombre,
      direccion: s.direccion,
      ciudad: s.ciudad,
      whatsapp: s.whatsapp,
      activa: s.activa,
    })),
    marcas,
  }
}

function nombreDeMarca(marca: Record<string, unknown> | undefined): string {
  return typeof marca?.nombre === "string" ? marca.nombre.trim() : ""
}
