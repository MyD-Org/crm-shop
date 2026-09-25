import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { bearerMatches } from "@/lib/secure-compare";

/**
 * Aviso del CRM de que algo del catálogo cambió.
 *
 * Ya no copia nada: la tienda lee el catálogo comercial (categorías, nombres,
 * fotos, visibilidad) directo de las tablas del CRM, en la misma base. Lo único
 * que queda por hacer es descartar lo que Next tenga renderizado en caché, para
 * que el cambio se vea en la próxima visita y no cuando venza.
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

  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true });
}
