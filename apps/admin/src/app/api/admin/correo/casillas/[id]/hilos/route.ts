import { NO_STORE, errorLectura } from "@/lib/correo-admin"
import { BUSQUEDA_MAX, parseCarpeta, parseLimite, requireCorreoLector } from "@/lib/correo-lectura"
import { reconciliarHilos } from "@/lib/correo-repo"
import { listThreads } from "@/lib/correo-resend"

type IdParams = { params: Promise<{ id: string }> }

// GET /api/admin/correo/casillas/[id]/hilos?folder=&q=&after=&limit= — hilos de una casilla.
// Cualquier rol CON acceso a la casilla (404 si no, o con el flag apagado). Pagina por cursor
// (`after` = id del último hilo de la página anterior) y busca por asunto. No devuelve ids
// internos de Resend de la casilla. De paso reconcilia el espejo (leído/carpeta) con la página.
export async function GET(req: Request, { params }: IdParams) {
  const { id } = await params
  const guard = await requireCorreoLector(req, id)
  if (!guard.ok) return guard.response

  const url = new URL(req.url)
  const folder = parseCarpeta(url.searchParams.get("folder"))
  const q = url.searchParams.get("q")?.trim().slice(0, BUSQUEDA_MAX) || undefined
  const after = url.searchParams.get("after") || undefined
  const limit = parseLimite(url.searchParams.get("limit"))

  try {
    const pagina = await listThreads(guard.casilla.resendInboxId, { folder, q, after, limit })
    // Best-effort: un fallo del espejo no debe impedir mostrar el listado.
    await reconciliarHilos(
      guard.casilla.id,
      folder,
      pagina.hilos.map((h) => ({ threadId: h.id, leido: h.leido, recibidoEn: new Date(h.recibidoEn) })),
    ).catch(() => console.error("[correo] no se pudo reconciliar el espejo de hilos"))
    return Response.json(pagina, { headers: NO_STORE })
  } catch (e) {
    return errorLectura(e)
  }
}
