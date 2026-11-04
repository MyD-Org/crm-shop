import { NextResponse, after } from "next/server";
import { revalidateTag } from "next/cache";
import { TAG_CATALOGO } from "@/lib/cache-tags";
import { bearerMatches } from "@/lib/secure-compare";
import { procesarAvisos } from "@/lib/aviso-reingreso-cron";

// El barrido del aviso de reingreso corre en `after` con este tope (un mail por aviso, hasta 200).
export const maxDuration = 120;

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
 * Además dispara, después de responder, el barrido del aviso de reingreso
 * (`procesarAvisos`): este ping es la señal de que el stock pudo cambiar. Llega
 * tras cada drenaje de webhooks de Alegra con cambios y tras la sync diaria,
 * que hace de respaldo (un ping perdido, una reserva vencida o un envío que
 * falló se resuelven en el próximo ping). Corridas solapadas son seguras: cada
 * aviso se reclama antes de enviarse y lleva clave de idempotencia.
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
  after(async () => {
    try {
      const r = await procesarAvisos();
      console.log(
        `[aviso-reingreso] omitido=${r.omitido} revisados=${r.revisados} enviados=${r.enviados} errores=${r.errores} purgados=${r.purgados}`,
      );
    } catch (err) {
      console.error("[aviso-reingreso] error inesperado:", err instanceof Error ? err.message : err);
    }
  });
  return NextResponse.json({ ok: true });
}
