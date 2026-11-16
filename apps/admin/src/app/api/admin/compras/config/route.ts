import { requireComprasAccess } from "@/lib/admin-route-guard"
import { listarAlmacenes, listarCategoriasContables, resolverCategoriaTransito } from "@/lib/alegra-compras"
import {
  configAlegraDeCuenta,
  cuentaActivaPorSlug,
  guardarConfigCompras,
  MSG_CUENTA_NO_EXISTE,
  obtenerConfigCompras,
  validarPatchConfig,
} from "@/lib/compras-config-repo"
import { fail, ok, responderError } from "@/lib/compras-http"
import { roleRank } from "@/lib/roles"

// GET /api/admin/compras/config?cuenta=<slug> — configuración de Compras de la cuenta y cómo se
//   resuelve hoy la cuenta contable «Mercadería en tránsito» (lectura de Alegra).
// PUT /api/admin/compras/config?cuenta=<slug> — la modifica. SÓLO admin o superior: el rol
//   «compras» puede leerla pero no cambiarla.

const MSG_SOLO_ADMIN = "Su rol no permite modificar la configuración de Compras."

export async function GET(req: Request) {
  const guard = await requireComprasAccess(req)
  if (!guard.ok) return guard.response

  const slug = new URL(req.url).searchParams.get("cuenta")?.trim() ?? ""
  const cuenta = slug ? await cuentaActivaPorSlug(guard.tenantId, slug) : null
  if (!cuenta) return fail(404, "cuenta_inexistente", MSG_CUENTA_NO_EXISTE)
  try {
    const cfg = await obtenerConfigCompras(guard.tenantId, cuenta.id)
    const config = await configAlegraDeCuenta(guard.tenantId, cuenta)
    const [cats, almacenes] = await Promise.all([listarCategoriasContables(config), listarAlmacenes(config)])
    const r = resolverCategoriaTransito(cats, { overrideId: cfg?.categoriaTransitoId ?? undefined })
    return ok({
      config: {
        categoriaTransitoId: cfg?.categoriaTransitoId ?? null,
        percepciones: cfg?.percepciones ?? {},
        almacenId: cfg?.almacenId ?? null,
      },
      transito: r.ok
        ? { estado: "ok", id: r.id }
        : {
            estado: r.motivo,
            candidatas: r.candidatas,
            mensaje:
              r.motivo === "ambigua"
                ? "Hay más de una cuenta «Mercadería en tránsito» en Alegra. Indique cuál usar."
                : "Falta crear la cuenta contable «Mercadería en tránsito» en Alegra.",
          },
      categorias: cats.filter((c) => c.tipo === "asset").map((c) => ({ id: c.id, nombre: c.nombre })),
      almacenes,
    })
  } catch (err) {
    return responderError(err, { tenant: guard.tenantId })
  }
}

export async function PUT(req: Request) {
  const guard = await requireComprasAccess(req)
  if (!guard.ok) return guard.response
  if (roleRank(guard.user.role) < roleRank("admin")) return fail(403, "forbidden", MSG_SOLO_ADMIN)

  const slug = new URL(req.url).searchParams.get("cuenta")?.trim() ?? ""
  const cuenta = slug ? await cuentaActivaPorSlug(guard.tenantId, slug) : null
  if (!cuenta) return fail(404, "cuenta_inexistente", MSG_CUENTA_NO_EXISTE)
  const v = validarPatchConfig(await req.json().catch(() => null))
  if (!v.ok) return fail(400, "validacion", v.error)
  try {
    const fila = await guardarConfigCompras(guard.tenantId, cuenta.id, v.value, guard.user.id)
    return ok({
      config: { categoriaTransitoId: fila.categoriaTransitoId, percepciones: fila.percepciones, almacenId: fila.almacenId },
    })
  } catch (err) {
    return responderError(err, { tenant: guard.tenantId })
  }
}
