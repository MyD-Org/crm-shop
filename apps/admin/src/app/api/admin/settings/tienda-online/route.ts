import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { requireAdminPlus } from "@/lib/admin-route-guard"
import { shopMediaConfig, basePublicaFotos } from "@/lib/shop-media"
import { pingShopRevalidarMarca } from "@/lib/shop-revalidar"
import { validarContrasteTema } from "@/lib/tema-contraste"
import { hostsMedia, parseTiendaOnline, verificarPrefijoMarca } from "@/lib/tienda-online"

// GET/PUT /api/admin/settings/tienda-online — marca de la tienda (`tenants.shop_marca`) y
// tema (`shop_tema`) y direcciones del Shop (`shop_url`, `shop_internal_url`). Datos → Tienda online. El UPDATE toca
// SOLO el tenant del guard; tras guardar se avisa al Shop de ESE tenant para que descarte su caché
// de marca (el ping nunca tira: si el Shop no responde, el guardado ya quedó).

const NO_STORE = { "Cache-Control": "private, no-store" }

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const [tenant] = await getDb()
    .select({ marca: tenants.shopMarca, tema: tenants.shopTema, shopUrl: tenants.shopUrl, shopInternalUrl: tenants.shopInternalUrl })
    .from(tenants)
    .where(eq(tenants.id, guard.tenantId))

  return Response.json(
    {
      marca: tenant?.marca ?? {},
      tema: tenant?.tema ?? {},
      shopUrl: tenant?.shopUrl ?? "",
      shopInternalUrl: tenant?.shopInternalUrl ?? "",
      imagenesDisponibles: shopMediaConfig() !== null,
    },
    { headers: NO_STORE },
  )
}

export async function PUT(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const parsed = parseTiendaOnline(await req.json().catch(() => null), { hosts: hostsMedia() })
  if (!parsed.ok) {
    return Response.json({ error: parsed.error, campo: parsed.campo, code: "invalid" }, { status: 400, headers: NO_STORE })
  }
  const propia = verificarPrefijoMarca(parsed.value.marca, basePublicaFotos(), guard.tenantId)
  if (!propia.ok) {
    return Response.json({ error: propia.error, campo: propia.campo, code: "invalid" }, { status: 400, headers: NO_STORE })
  }

  const { marca, shopUrl, shopInternalUrl, tema } = parsed.value
  if (tema?.colores) {
    const contraste = validarContrasteTema(tema.colores)
    if (!contraste.ok) {
      return Response.json({ error: contraste.error, campo: contraste.campo, code: "invalid" }, { status: 400, headers: NO_STORE })
    }
  }

  // Sin `tema` en el cuerpo no se toca lo guardado; con `tema: {}` vuelve al tema de partida.
  await getDb()
    .update(tenants)
    .set({ shopMarca: marca, shopUrl, shopInternalUrl, ...(tema ? { shopTema: tema } : {}), updatedAt: new Date() })
    .where(eq(tenants.id, guard.tenantId))

  const { propagado } = await pingShopRevalidarMarca(guard.tenantId)
  return Response.json({ ok: true, marca, tema, shopUrl, shopInternalUrl, propagado }, { headers: NO_STORE })
}
