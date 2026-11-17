import { listarMarcas, type MarcaDto } from "@/lib/precios-online-repo"
import { urlPublicaShopDeTenant, type EnvShop } from "@/lib/shop-destino"
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

export interface ContextoEtiquetas {
  tenant: {
    nombre: string
    /** Rubro por defecto de la etiqueta de tienda (`tenants.subtitle`). */
    rubro: string
    logoPath: string
    /** URL pública del Shop del tenant; null = sin tienda (no se pueden armar QR). */
    shopUrl: string | null
  }
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
  return {
    tenant: {
      nombre: tenant?.name ?? "",
      rubro: tenant?.subtitle ?? "",
      logoPath: tenant?.logoPath ?? "",
      shopUrl: tenant ? urlPublicaShopDeTenant(tenant, env) : null,
    },
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
