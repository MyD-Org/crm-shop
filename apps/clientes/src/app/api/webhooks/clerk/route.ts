import { NextResponse, type NextRequest } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import {
  datosDeUsuarioClerk,
  eliminarUsuarioClerk,
  registrarUsuarioClerk,
} from "@/lib/clientes-espejo";
import { shopTenantId } from "@/lib/tenant";

/**
 * Webhook de Clerk → espejo de usuarios `shop.clientes` (migración 0018).
 *
 * Eventos: `user.created`, `user.updated`, `user.deleted` (configurados en el
 * dashboard de Clerk). Cualquier otro tipo responde 200 sin escribir: no tiene
 * sentido que Clerk reintente lo que nunca se va a procesar.
 *
 * - Firma: `verifyWebhook` (Svix) con `CLERK_WEBHOOK_SIGNING_SECRET`. Sin el
 *   secreto responde 500 (Clerk reintenta y no se confunde con una firma
 *   inválida); nunca acepta sin verificar.
 * - Tenant: el del deploy (`SHOP_TENANT_ID`), nunca uno del payload.
 * - Responde 2xx recién DESPUÉS de escribir; si la base falla, 500 y Clerk
 *   reintenta con backoff. El orden de eventos y la idempotencia los resuelve
 *   la función SQL (un evento viejo vuelve 'ignorado', igual 200).
 * - Logs de una línea con tipo, id de usuario y resultado. Nunca email, nombre
 *   ni payload.
 *
 * OJO: esta ruta tiene que estar en RUTAS_PUBLICAS del gate (src/proxy.ts).
 * Clerk no tiene cookie: sin eso la cortina de "Próximamente" le responde 200
 * con HTML y Clerk da el evento por entregado.
 */
export async function POST(req: NextRequest) {
  if (!process.env.CLERK_WEBHOOK_SIGNING_SECRET?.trim()) {
    console.error("clerk-webhook: falta el secreto");
    return NextResponse.json({ error: "Webhook no configurado" }, { status: 500 });
  }

  let evt: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    evt = await verifyWebhook(req);
  } catch {
    console.warn("clerk-webhook: firma inválida");
    return NextResponse.json({ error: "Firma inválida" }, { status: 400 });
  }

  const tipo = evt.type;
  if (tipo !== "user.created" && tipo !== "user.updated" && tipo !== "user.deleted") {
    return NextResponse.json({ ok: true, ignorado: "evento" });
  }

  const id = typeof evt.data.id === "string" ? evt.data.id : "";
  if (!id) {
    console.warn(`clerk-webhook tipo=${tipo} sin id`);
    return NextResponse.json({ ok: true, ignorado: "sin id" });
  }

  try {
    const tenant = shopTenantId();
    const resultado =
      evt.type === "user.deleted"
        ? await eliminarUsuarioClerk(tenant, id)
        : await registrarUsuarioClerk(tenant, datosDeUsuarioClerk(evt.data));
    console.info(`clerk-webhook tipo=${tipo} id=${id} resultado=${resultado}`);
    return NextResponse.json({ ok: true, resultado });
  } catch (err) {
    // Sólo el nombre y el código: el mensaje de un error de Postgres puede traer valores.
    const nombre = err instanceof Error ? err.name : "desconocido";
    const codigo = (err as { code?: unknown })?.code;
    console.error(`clerk-webhook tipo=${tipo} id=${id} error=${nombre}${codigo ? ` codigo=${String(codigo)}` : ""}`);
    return NextResponse.json({ error: "No se pudo registrar el evento" }, { status: 500 });
  }
}
