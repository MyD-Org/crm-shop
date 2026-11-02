import { requireAdminPlus } from "@/lib/admin-route-guard"
import { DIAS_VENTANA, resumenIntentos } from "@/lib/pagos-intentos-repo"

// GET /api/admin/pagos-intentos/resumen?dias= — resumen de intentos de cobro por proveedor y cuenta
// en la ventana pedida (1, 7 o 30 días; 7 por defecto): aprobados, cada causa de falla y tasa de
// fallo. Sólo admin y superadmin. El tenant sale SÓLO del guard.

const NO_STORE = { "Cache-Control": "private, no-store" }

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const diasParam = new URL(req.url).searchParams.get("dias")
  const dias = diasParam === null ? 7 : Number(diasParam)
  if (!(DIAS_VENTANA as readonly number[]).includes(dias)) {
    return Response.json({ error: "El período es inválido", code: "invalid" }, { status: 400, headers: NO_STORE })
  }

  try {
    return Response.json(await resumenIntentos(guard.tenantId, { dias }), { headers: NO_STORE })
  } catch (err) {
    const e = err as { name?: unknown; code?: unknown }
    console.error(
      `[admin/pagos-intentos/resumen] no se pudo calcular tenant=${guard.tenantId} error=${String(e?.name ?? "Error")} codigo=${String(e?.code ?? "sin código")}`,
    )
    return Response.json(
      { error: "No se pudo cargar el resumen de intentos de pago. Inténtelo nuevamente.", code: "internal" },
      { status: 500, headers: NO_STORE },
    )
  }
}
