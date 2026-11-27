import { notFound } from "next/navigation"
import { accesoSeccion } from "@/lib/secciones-acceso"
import {
  CLIENTES_TIENDA_DEFAULT_LIMIT,
  listarClientesTienda,
  listarTiendasClientes,
  type ClienteTiendaDto,
} from "@/lib/clientes-tienda-repo"
import { listarCuentasParaVincular, type CuentaParaVincular } from "@/lib/clientes-tienda-acciones"
import { ClientesTiendaShell } from "@/components/admin/clientes-tienda/ClientesTiendaShell"

export const dynamic = "force-dynamic"

const ERROR_PAGINA = "No se pudo cargar el listado. Inténtelo de nuevo."

// "Clientes de la tienda": usuarios registrados en el Shop (espejo de Clerk) con su vínculo a
// Alegra, acceso a Facturación y pedidos. La ve quien tiene la sección
// (`accesoSeccion`, igual que `requireSeccion` en la API); los botones del detalle (vincular,
// desvincular, dar y quitar acceso a Facturación) siguen a la misma sección, como sus APIs
// (`puedeGestionar`); la autoridad es `requireSeccion` en cada API. Sin sesión, el layout protegido
// ya redirigió al login; acá se repite el guard para tener el tenant verificado por host y el
// rol FRESCO de la base, nunca los de la cookie.
export default async function ClientesTiendaPage() {
  const guard = await accesoSeccion("clientes-tienda")
  if (!guard) notFound()

  // Primera página sin filtros, directo del repo (no se le pega a la propia API). Si falla se
  // muestra el aviso y el shell reintenta por la API al montar.
  let items: ClienteTiendaDto[] = []
  let total = 0
  let error = ""
  // Cuentas de Alegra para el selector del diálogo "Vincular". Si fallan se ofrece sólo la
  // principal (el comportamiento de siempre).
  let cuentas: CuentaParaVincular[] = [{ clave: "principal", nombre: "Cuenta principal" }]
  // Tiendas (sitios) con usuarios, para la columna y el filtro. Si falla, no se muestran.
  let tiendas: string[] = []
  try {
    ;[{ items, total }, cuentas, tiendas] = await Promise.all([
      listarClientesTienda(guard.tenantId),
      listarCuentasParaVincular(guard.tenantId).catch(() => cuentas),
      listarTiendasClientes(guard.tenantId).catch(() => tiendas),
    ])
  } catch (err) {
    const e = err as { name?: unknown; code?: unknown }
    console.error(
      `[admin/clientes-tienda] no se pudo cargar la página tenant=${guard.tenantId} error=${String(e?.name ?? "Error")} codigo=${String(e?.code ?? "sin código")}`,
    )
    error = ERROR_PAGINA
  }

  return (
    <div className="p-4 md:p-6">
      {/* pl-10 md:pl-0: en mobile corre el título para que no lo tape el botón ☰ del sidebar. */}
      <div className="mb-4 md:mb-6 pl-10 md:pl-0">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Clientes de la tienda</h1>
        <p className="hidden md:block text-sm mt-0.5" style={{ color: "var(--ink-soft)" }}>
          Personas registradas en la tienda
        </p>
      </div>
      <ClientesTiendaShell
        initialItems={items}
        initialTotal={total}
        initialError={error}
        pageSize={CLIENTES_TIENDA_DEFAULT_LIMIT}
        puedeGestionar
        cuentas={cuentas}
        tiendas={tiendas}
      />
    </div>
  )
}
