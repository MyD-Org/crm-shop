import { hashToken } from "@/lib/admin-crypto"
import { emitirCodigo, promocionPorToken } from "@/lib/cupones-repo"
import { PreciosOnlineError } from "@/lib/precios-online-repo"
import { permitirAsync, respuestaLimite } from "@/lib/rate-limit"
import { urlPublicaShopDeTenant } from "@/lib/shop-destino"
import { resolveRequestTenantId } from "@/lib/tenant-context"
import { getTenantByIdFromDb } from "@/lib/tenants"

// POST /api/integraciones/cupones/emitir — lo llama el bot de DM de Instagram después de verificar
// que la persona sigue la cuenta (spec 2026-11-01-cupones-design.md, "Endpoint para el bot").
//
// Auth: `Authorization: Bearer <token>` de UNA promoción de códigos únicos (generado en el CRM;
// la base guarda sólo su sha256 y se busca por igualdad del hash: el tiempo no depende del
// secreto). El token identifica tenant y promoción; el tenant tiene que coincidir con el host.
// Body `{ referencia }` (id del contacto en el bot, 1..128) -> 200 { codigo, link, venceEn, nuevo }.
// Misma referencia -> mismo código. 401 / 400 / 409 `promocion_inactiva` | `limite_alcanzado` /
// 429 (60 por minuto por token). Log de una línea sin datos personales (nunca la referencia).

const NO_STORE = { "Cache-Control": "private, no-store" }
const TOKEN_RE = /^Bearer ([0-9a-f]{64})$/
const REFERENCIA_MAX = 128
const USOS_POR_MINUTO = 60

const noAutorizado = () => Response.json({ error: "No autorizado." }, { status: 401, headers: NO_STORE })
const invalido = () =>
  Response.json({ error: "Indique la referencia del contacto (hasta 128 caracteres)." }, { status: 400, headers: NO_STORE })

function log(promocionId: string, resultado: string, nuevo?: boolean) {
  console.info(`[cupones-emitir] promocion=${promocionId} resultado=${resultado}${nuevo === undefined ? "" : ` nuevo=${nuevo}`}`)
}

export async function POST(req: Request) {
  const m = TOKEN_RE.exec(req.headers.get("authorization")?.trim() ?? "")
  if (!m) return noAutorizado()
  const promo = await promocionPorToken(hashToken(m[1]))
  if (!promo) return noAutorizado()
  const tenantId = await resolveRequestTenantId(req)
  if (!tenantId || tenantId !== promo.tenantId) return noAutorizado()

  if (!(await permitirAsync(`cupones-emitir:${promo.id}`, USOS_POR_MINUTO, 60_000))) {
    log(promo.id, "limite_de_uso")
    return respuestaLimite()
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return invalido()
  }
  const referencia = (body as { referencia?: unknown } | null)?.referencia
  if (typeof referencia !== "string" || !referencia.trim() || referencia.trim().length > REFERENCIA_MAX) return invalido()

  try {
    const r = await emitirCodigo(promo.tenantId, promo.id, referencia.trim())
    const tenant = await getTenantByIdFromDb(promo.tenantId)
    const base = tenant ? urlPublicaShopDeTenant(tenant, process.env) : null
    log(promo.id, "ok", r.nuevo)
    return Response.json(
      { codigo: r.codigo, link: base ? `${base}/?cupon=${encodeURIComponent(r.codigo)}` : null, venceEn: r.venceEn, nuevo: r.nuevo },
      { headers: NO_STORE },
    )
  } catch (err) {
    if (err instanceof PreciosOnlineError) {
      log(promo.id, err.code)
      return Response.json({ error: err.message, code: err.code }, { status: err.status, headers: NO_STORE })
    }
    throw err
  }
}
