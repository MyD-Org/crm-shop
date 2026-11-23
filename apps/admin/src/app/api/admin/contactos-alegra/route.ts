import { requireSeccion } from "@/lib/admin-route-guard"
import {
  BUSCAR_CONTACTOS_Q_MAX,
  BUSCAR_CONTACTOS_Q_MIN,
  buscarContactosParaVincular,
  esCuentaDelTenant,
} from "@/lib/clientes-tienda-acciones"

// GET /api/admin/contactos-alegra?q=&cuenta= — buscador del diálogo "Vincular" de "Clientes de
// la tienda": clientes activos de la cuenta de Alegra `cuenta` del tenant ('principal' por
// defecto; validada contra las del tenant) por razón social, CUIT o email (hasta 10). Sólo con la sección Clientes de la tienda (`requireSeccion`), que es donde vive el
// diálogo. El tenant sale SÓLO del guard.

const NO_STORE = { "Cache-Control": "private, no-store" }

const fail = (status: number, code: string, error: string) =>
  Response.json({ error, code }, { status, headers: NO_STORE })

export async function GET(req: Request) {
  const guard = await requireSeccion(req, "clientes-tienda")
  if (!guard.ok) return guard.response

  const params = new URL(req.url).searchParams
  const q = (params.get("q") ?? "").trim()
  if (q.length < BUSCAR_CONTACTOS_Q_MIN) return fail(400, "q_corta", "Ingrese al menos 2 caracteres para buscar.")
  if (q.length > BUSCAR_CONTACTOS_Q_MAX) return fail(400, "invalid", "La búsqueda es demasiado larga.")
  const cuenta = params.get("cuenta") || "principal"

  try {
    if (!(await esCuentaDelTenant(guard.tenantId, cuenta))) {
      return fail(400, "cuenta_invalida", "Seleccione una cuenta de Alegra válida.")
    }
    const items = await buscarContactosParaVincular(guard.tenantId, q, cuenta)
    return Response.json({ items }, { headers: NO_STORE })
  } catch (err) {
    const e = err as { name?: unknown; code?: unknown }
    console.error(
      `[admin/contactos-alegra] no se pudo buscar tenant=${guard.tenantId} error=${String(e?.name ?? "Error")} codigo=${String(e?.code ?? "sin código")}`,
    )
    return fail(500, "internal", "No se pudieron buscar los clientes de Alegra. Inténtelo nuevamente.")
  }
}
