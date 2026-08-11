import { NextResponse } from "next/server";
import { identidadActual, idPriceListDe } from "@/lib/auth";
import { cotizar, normalizarLineas, MAX_LINEAS } from "@/lib/cotizacion";
import { evaluarEnvio, pagosDisponibles, type EntregaTipo } from "@/lib/envio";
import { permitir } from "@/lib/rate-limit";

// Precio y stock en vivo desde Alegra: nunca cacheable.
export const dynamic = "force-dynamic";

/**
 * Techo por usuario.
 *
 * Esta ruta es un amplificador: un request se abre en hasta MAX_LINEAS (60)
 * llamadas a Alegra. Sin límite, un solo usuario logueado agota la cuota de la
 * API y se lleva puestos el catálogo y el checkout para todos.
 *
 * 20 por minuto es holgado para el uso real —el carrito recotiza al cambiar
 * cantidades, con debounce— y deja el peor caso en 1.200 llamadas por minuto
 * por usuario en vez de ilimitadas.
 */
const MAX_POR_MINUTO = 20;

/**
 * POST /api/carrito/cotizar
 * Body: { items: [{ id, qty }], entregaTipo?, ciudad? }
 *
 * Devuelve los totales que el shop compromete. Es la única fuente de verdad del
 * precio: el carrito y el checkout muestran lo que devuelve esta ruta, no lo que
 * tienen en memoria. Ver src/lib/cotizacion.ts.
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
      pagosDisponibles: pagosDisponibles(entregaTipo),
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
      ? await idPriceListDe(cliente.codigocliente)
      : undefined;
    const cotizacion = await cotizar(lineas, { idPriceList, entregaTipo });

    return NextResponse.json({
      ...cotizacion,
      envio: evaluarEnvio(cotizacion.subtotal, ciudad),
      pagosDisponibles: pagosDisponibles(entregaTipo),
    });
  } catch (err) {
    console.error("[/api/carrito/cotizar] error:", err);
    return NextResponse.json(
      { error: "No pudimos calcular el total. Probá de nuevo en un momento." },
      { status: 502 },
    );
  }
}
