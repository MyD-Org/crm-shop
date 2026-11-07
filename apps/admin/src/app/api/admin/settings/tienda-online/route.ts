import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { requireAdminPlus } from "@/lib/admin-route-guard"
import { shopMediaConfig, basePublicaFotos } from "@/lib/shop-media"
import { pingShopRevalidarMarca } from "@/lib/shop-revalidar"
import { validarContrasteTema } from "@/lib/tema-contraste"
import { parsearDestinosExtra } from "@/lib/shop-destino"
import { aplicarEdicionDestinos, hostsMedia, parseTiendaOnline, verificarPrefijoMarca, type Parse } from "@/lib/tienda-online"

// GET/PUT /api/admin/settings/tienda-online — marca de la tienda (`tenants.shop_marca`) y
// tema (`shop_tema`) y direcciones del Shop (`shop_url`, `shop_internal_url`). Datos → Tienda online. El UPDATE toca
// SOLO el tenant del guard; tras guardar se avisa al Shop de ESE tenant para que descarte su caché
// de marca (el ping nunca tira: si el Shop no responde, el guardado ya quedó).
// Marca por dominio: `destinos` lleva marca, tema y remitente de cada dominio extra
// (`shop_destinos_extra`); sólo se editan esas claves, nunca las URLs de los sitios.

const NO_STORE = { "Cache-Control": "private, no-store" }

/** Sitios extra válidos como los ve el formulario (sin la URL interna). */
function destinosParaPantalla(raw: unknown, shopUrl?: string, shopInternalUrl?: string) {
  return parsearDestinosExtra(raw, [shopUrl, shopInternalUrl]).validos.map((d) => ({
    etiqueta: d.etiqueta,
    url: d.url,
    marca: d.marca ?? {},
    tema: d.tema ?? {},
    remitente: d.remitente ?? "",
  }))
}

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const [tenant] = await getDb()
    .select({
      marca: tenants.shopMarca,
      tema: tenants.shopTema,
      shopUrl: tenants.shopUrl,
      shopInternalUrl: tenants.shopInternalUrl,
      destinos: tenants.shopDestinosExtra,
    })
    .from(tenants)
    .where(eq(tenants.id, guard.tenantId))

  const destinos = destinosParaPantalla(tenant?.destinos, tenant?.shopUrl, tenant?.shopInternalUrl)

  return Response.json(
    {
      marca: tenant?.marca ?? {},
      tema: tenant?.tema ?? {},
      shopUrl: tenant?.shopUrl ?? "",
      shopInternalUrl: tenant?.shopInternalUrl ?? "",
      destinos,
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

  const { marca, shopUrl, shopInternalUrl, tema, destinos } = parsed.value
  if (tema?.colores) {
    const contraste = validarContrasteTema(tema.colores)
    if (!contraste.ok) {
      return Response.json({ error: contraste.error, campo: contraste.campo, code: "invalid" }, { status: 400, headers: NO_STORE })
    }
  }

  for (const d of destinos ?? []) {
    const delSitio = (r: { error: string; campo: string }) =>
      Response.json({ error: `Sitio «${d.etiqueta}»: ${r.error}`, campo: `${d.etiqueta}.${r.campo}`, code: "invalid" }, { status: 400, headers: NO_STORE })
    if (d.marca) {
      const propiaSitio = verificarPrefijoMarca(d.marca, basePublicaFotos(), guard.tenantId)
      if (!propiaSitio.ok) return delSitio(propiaSitio)
    }
    if (d.tema?.colores) {
      const contraste = validarContrasteTema(d.tema.colores)
      if (!contraste.ok) return delSitio(contraste)
    }
  }

  // Sin `destinos` en el cuerpo no se toca la columna; con `destinos` se reescribe la lista
  // completa cambiando sólo marca, tema y remitente de los sitios indicados.
  let destinosExtra: Parse<unknown[]> | null = null
  if (destinos) {
    const [actual] = await getDb()
      .select({ destinos: tenants.shopDestinosExtra })
      .from(tenants)
      .where(eq(tenants.id, guard.tenantId))
    destinosExtra = aplicarEdicionDestinos(actual?.destinos ?? [], destinos)
    if (!destinosExtra.ok) {
      return Response.json({ error: destinosExtra.error, campo: destinosExtra.campo, code: "invalid" }, { status: 400, headers: NO_STORE })
    }
  }

  // Sin `tema` en el cuerpo no se toca lo guardado; con `tema: {}` vuelve al tema de partida.
  await getDb()
    .update(tenants)
    .set({
      shopMarca: marca,
      shopUrl,
      shopInternalUrl,
      ...(tema ? { shopTema: tema } : {}),
      ...(destinosExtra?.ok ? { shopDestinosExtra: destinosExtra.value } : {}),
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, guard.tenantId))

  const { propagado } = await pingShopRevalidarMarca(guard.tenantId)
  return Response.json(
    {
      ok: true,
      marca,
      tema,
      shopUrl,
      shopInternalUrl,
      ...(destinosExtra?.ok ? { destinos: destinosParaPantalla(destinosExtra.value, shopUrl, shopInternalUrl) } : {}),
      propagado,
    },
    { headers: NO_STORE },
  )
}
