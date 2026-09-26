import { requireAdminPlus } from "@/lib/admin-route-guard"
import {
  BUSCAR_CONTACTOS_Q_MAX,
  BUSCAR_CONTACTOS_Q_MIN,
  buscarContactosParaVincular,
} from "@/lib/clientes-tienda-acciones"

// GET /api/admin/contactos-alegra?q= — buscador del diálogo "Vincular" de "Clientes de la
// tienda": clientes activos de la cuenta principal del tenant por razón social, CUIT o email
// (hasta 10). Sólo admin y superadmin: sirve únicamente a una acción que es de admin+. El
// tenant sale SÓLO del guard.

const NO_STORE = { "Cache-Control": "private, no-store" }

const fail = (status: number, code: string, error: string) =>
  Response.json({ error, code }, { status, headers: NO_STORE })

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim()
  if (q.length < BUSCAR_CONTACTOS_Q_MIN) return fail(400, "q_corta", "Ingrese al menos 2 caracteres para buscar.")
  if (q.length > BUSCAR_CONTACTOS_Q_MAX) return fail(400, "invalid", "La búsqueda es demasiado larga.")

  try {
    const items = await buscarContactosParaVincular(guard.tenantId, q)
    return Response.json({ items }, { headers: NO_STORE })
  } catch (err) {
    const e = err as { name?: unknown; code?: unknown }
    console.error(
      `[admin/contactos-alegra] no se pudo buscar tenant=${guard.tenantId} error=${String(e?.name ?? "Error")} codigo=${String(e?.code ?? "sin código")}`,
    )
    return fail(500, "internal", "No se pudieron buscar los clientes de Alegra. Inténtelo nuevamente.")
  }
}
