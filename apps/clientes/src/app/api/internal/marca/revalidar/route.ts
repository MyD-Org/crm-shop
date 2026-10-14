import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { TAG_HOME, TAG_MARCA } from "@/lib/cache-tags";
import { bearerMatches } from "@/lib/secure-compare";

/**
 * Aviso del CRM de que cambió la marca de la tienda (Datos -> Tienda online). Vence la caché de la
 * marca (tag `marca`, src/lib/marca.ts) y la de la home (tag `home`: el footer y la home de una
 * tienda genérica toman de la marca el nombre y la descripción), con `{ expire: 0 }`: la próxima
 * visita lee la base. Si el aviso se pierde, el perfil `marca` vence solo a la hora.
 *
 * SIN payload a propósito y autenticado con SHOP_CRM_SECRET, igual que el aviso del catálogo.
 *
 * OJO: esta ruta tiene que estar en RUTAS_PUBLICAS del gate (src/proxy.ts). Si no, la cortina de
 * "Próximamente" responde 200 con HTML y el CRM lo toma por éxito.
 */
export async function POST(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.SHOP_CRM_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  revalidateTag(TAG_MARCA, { expire: 0 });
  revalidateTag(TAG_HOME, { expire: 0 });
  return NextResponse.json({ ok: true });
}
