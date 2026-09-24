import { NextResponse } from "next/server";
import { identidadActual, idPriceListCliente } from "@/lib/auth";
import { cotizar, normalizarLineas, MAX_LINEAS } from "@/lib/cotizacion";
import { evaluarEnvio, pagosDisponibles, type EntregaTipo } from "@/lib/envio";
import { pagosHabilitados } from "@/lib/pagos-flag";
import { permitir } from "@/lib/rate-limit";

// Depende del usuario y del espejo del momento: nunca cacheable.
export const dynamic = "force-dynamic";

/**
 * Techo por usuario.
 *
 * Esta ruta ya no toca Alegra (cotiza desde el espejo), pero cada request es
 * una consulta a la base: el techo evita que un cliente en loop la martille.
 * 20 por minuto es holgado para el uso real —el carrito recotiza al cambiar
 * cantidades, con debounce—.
 */
const MAX_POR_MINUTO = 20;

/**
 * POST /api/carrito/cotizar
 * Body: { items: [{ id, qty }], entregaTipo?, ciudad? }
 *
 * Totales del carrito leídos del espejo (`catalog_products` + lista de precios
 * del snapshot de `client_links`), sin llamadas a Alegra. El carrito y el
 * checkout muestran lo que devuelve esta ruta, no lo que tienen en memoria, y
 * `POST /api/pedidos` registra el mismo número. Ver src/lib/cotizacion.ts.
 */
export async function POST(req: Request) {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const quien = clerkUserId ?? cliente!.codigocliente;
  if (!permitir(`cotizar:${quien}`, MAX_POR_MINUTO, 60_000)) {
    return NextResponse.json(
      { error: "Estás recalculando muy seguido. Esperá unos segundos." },
      { status: 429 },
    );
  }

  let body: { items?: unknown; entregaTipo?: unknown; ciudad?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const lineas = normalizarLineas(body.items);
  const entregaTipo: EntregaTipo =
    body.entregaTipo === "envio" ? "envio" : "retiro";
  const ciudad = typeof body.ciudad === "string" ? body.ciudad : undefined;

  if (lineas.length === 0) {
    return NextResponse.json({
      lineas: [],
      subtotal: 0,
      iva: 0,
      costoEnvio: 0,
      total: 0,
      hayProblemas: false,
      envio: evaluarEnvio(0, ciudad),
      pagosDisponibles: pagosDisponibles(entregaTipo, await pagosHabilitados()),
    });
  }

  if (!Array.isArray(body.items) || body.items.length > MAX_LINEAS) {
    return NextResponse.json(
      { error: `El pedido no puede tener más de ${MAX_LINEAS} productos distintos.` },
      { status: 400 },
    );
  }

  try {
    const idPriceList = cliente
      ? await idPriceListCliente(cliente.codigocliente)
      : undefined;
    const cotizacion = await cotizar(lineas, { idPriceList, entregaTipo });

    return NextResponse.json({
      ...cotizacion,
      envio: evaluarEnvio(cotizacion.subtotal, ciudad),
      pagosDisponibles: pagosDisponibles(entregaTipo, await pagosHabilitados()),
    });
  } catch (err) {
    console.error("[/api/carrito/cotizar] error:", err);
    return NextResponse.json(
      { error: "No pudimos calcular el total. Probá de nuevo en un momento." },
      { status: 502 },
    );
  }
}
