import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { TAG_CATALOGO } from "@/lib/cache-tags";
import { bearerMatches } from "@/lib/secure-compare";

/**
 * Aviso del CRM de que algo del catálogo cambió: al guardar overlay o
 * categorías, al terminar la sync de Alegra y al drenar webhooks de stock con
 * cambios (contrato `crm-shop-base/v1` en MyD-Org/platform).
 *
 * No copia nada: la tienda lee el catálogo directo de las vistas del CRM, en
 * la misma base. Lo único que hace es vencer las cachés de datos del catálogo
 * (tag `catalogo`: listado, facetas, ficha, nav y destacados, ver
 * src/lib/catalogo-publico.ts) con `{ expire: 0 }`: la próxima visita lee la
 * base, no la copia vieja. Si este aviso se pierde, el perfil `catalogo`
 * vence solo a los 15 minutos.
 *
 * SIN payload a propósito y autenticado con SHOP_CRM_SECRET, la llave propia
 * del Shop.
 *
 * OJO: esta ruta tiene que estar en RUTAS_PUBLICAS del gate (src/proxy.ts). Si
 * no, la cortina de "Próximamente" responde 200 con HTML y el CRM lo toma por
 * éxito.
 */
export async function POST(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.SHOP_CRM_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  revalidateTag(TAG_CATALOGO, { expire: 0 });
  return NextResponse.json({ ok: true });
}
