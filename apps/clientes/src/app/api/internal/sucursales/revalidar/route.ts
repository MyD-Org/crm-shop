import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { TAG_CATALOGO, TAG_SUCURSALES } from "@/lib/cache-tags";
import { bearerMatches } from "@/lib/secure-compare";

/**
 * Aviso del CRM de que cambiaron las sucursales o las zonas (Configuración ->
 * Sucursales y ventas). Vence la caché de datos de sucursales (tag `sucursales`,
 * src/lib/sucursales-datos.ts) y la del catálogo (tag `catalogo`: la
 * disponibilidad por sucursal depende de estas reglas), con `{ expire: 0 }`: la
 * próxima visita lee la base. Si el aviso se pierde, el perfil `sucursales`
 * vence solo a los 5 minutos.
 *
 * SIN payload a propósito y autenticado con SHOP_CRM_SECRET, igual que el aviso
 * del catálogo. Los pedidos NO dependen de esta caché: releen las reglas sin
 * caché dentro de la transacción.
 *
 * OJO: esta ruta tiene que estar en RUTAS_PUBLICAS del gate (src/proxy.ts). Si
 * no, la cortina de "Próximamente" responde 200 con HTML y el CRM lo toma por
 * éxito.
 */
export async function POST(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.SHOP_CRM_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  revalidateTag(TAG_SUCURSALES, { expire: 0 });
  revalidateTag(TAG_CATALOGO, { expire: 0 });
  return NextResponse.json({ ok: true });
}
