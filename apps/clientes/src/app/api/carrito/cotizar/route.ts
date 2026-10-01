import { NextResponse } from "next/server";
import { identidadActual, idPriceListCliente } from "@/lib/auth";
import { catalogoSoloVisibles } from "@/lib/catalogo-flag";
import { cotizar, normalizarLineas, MAX_LINEAS } from "@/lib/cotizacion";
import { evaluarEnvio, type EntregaTipo } from "@/lib/envio";
import { leerConfigEnvio } from "@/lib/sucursales-repo";
import { permitir } from "@/lib/rate-limit";
import { dispDelVisitante } from "@/lib/zona-servidor";
import { contextoUnion } from "@/lib/disponibilidad-contexto";
import { contextoParaProvincia, disponibilidadParaMostrar } from "@/lib/disponibilidad-vista";
import { claveProvincia } from "@/lib/sucursales";
import { cuentasBancariasCacheadas } from "@/lib/cuentas-bancarias-datos";
import { cuentaParaVistaPrevia } from "@/lib/cuenta-transferencia";
import { sucursalesCacheadas } from "@/lib/sucursales-datos";
import { sucursalesHabilitadas } from "@/lib/sucursales-flag";

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
 * Techo por IP para visitantes sin sesión: frena a un bot en loop. Más alto
 * que el de usuario porque una IP puede ser compartida (red de la operadora,
 * wifi de un local); una persona real no llega.
 */
const MAX_POR_MINUTO_VISITANTE = 60;

/** Primera IP de `x-forwarded-for` (la pone Vercel), o null. */
function ipDe(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

/**
 * POST /api/carrito/cotizar
 * Body: { items: [{ id, qty }], entregaTipo?, provincia? }
 * `provincia`: la de entrega (checkout) o la de la ubicación del cliente; con ella y la
 * configuración de envío releída SIN caché (`leerConfigEnvio`) se evalúa `envio` (gratis, a
 * coordinar, cuánto falta). Con el flag `disponibilidad-sucursal` también define la sucursal de la
 * zona con la que se calcula la disponibilidad; con el flag prendido la respuesta suma
 * `disponibilidad` (envío y retiro por local, por producto).
 *
 * Totales del carrito leídos del catálogo del CRM (vista `catalog_products_shop` + lista de precios
 * del snapshot de `client_links`), sin llamadas a Alegra. El carrito y el
 * checkout muestran lo que devuelve esta ruta, no lo que tienen en memoria, y
 * `POST /api/pedidos` registra el mismo número. Ver src/lib/cotizacion.ts.
 *
 * Sin sesión también cotiza: con la lista principal (L1), la misma que ve en
 * el catálogo y la misma que usa un cliente todavía no vinculado. Así el
 * visitante ve el IVA y el total final antes de iniciar sesión; para comprar
 * la sesión sigue siendo obligatoria (checkout y `POST /api/pedidos`).
 */
export async function POST(req: Request) {
  const { clerkUserId, cliente } = await identidadActual();

  const quien = clerkUserId ?? cliente?.codigocliente;
  const permitido = quien
    ? permitir(`cotizar:${quien}`, MAX_POR_MINUTO, 60_000)
    : permitir(`cotizar:ip:${ipDe(req) ?? "desconocida"}`, MAX_POR_MINUTO_VISITANTE, 60_000);
  if (!permitido) {
    return NextResponse.json(
      { error: "Está recalculando muy seguido. Espere unos segundos." },
      { status: 429 },
    );
  }

  let body: {
    items?: unknown;
    entregaTipo?: unknown;
    provincia?: unknown;
    conCuenta?: unknown;
    sucursalRetiro?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const lineas = normalizarLineas(body.items);
  const entregaTipo: EntregaTipo =
    body.entregaTipo === "envio" ? "envio" : "retiro";
  const provinciaTexto = typeof body.provincia === "string" ? body.provincia : null;

  if (lineas.length === 0) {
    return NextResponse.json({
      lineas: [],
      subtotal: 0,
      iva: 0,
      costoEnvio: 0,
      total: 0,
      hayProblemas: false,
      envio: evaluarEnvio(0, provinciaTexto, await leerConfigEnvio()),
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
    // Flag `disponibilidad-sucursal`: stock por sucursal (unión) y disponibilidad por modalidad.
    const base = await dispDelVisitante();
    const provincia = provinciaTexto ? claveProvincia(provinciaTexto) : "";
    const disp = base ? await contextoParaProvincia(base, provincia || null) : undefined;
    const cotizacion = await cotizar(lineas, {
      soloVisibles: await catalogoSoloVisibles(),
      idPriceList,
      entregaTipo,
      disp: disp ? contextoUnion(disp) : undefined,
    });
    const disponibilidad = await disponibilidadParaMostrar(
      lineas.map((l) => l.id),
      disp,
      Object.fromEntries(lineas.map((l) => [l.id, l.qty])),
    );

    // Vista previa de la cuenta de la transferencia (sólo con identidad: el checkout exige
    // sesión). Se resuelve con lecturas cacheadas y el total cotizado; el pedido la vuelve a
    // resolver sin caché y la congela.
    let cuentaTransferencia: Awaited<ReturnType<typeof cuentaParaVistaPrevia>> | undefined;
    if (body.conCuenta === true && (clerkUserId || cliente)) {
      const [cuentas, datos, sucursalesActivas] = await Promise.all([
        cuentasBancariasCacheadas(),
        sucursalesCacheadas(),
        sucursalesHabilitadas(),
      ]);
      const sucursalRetiro =
        entregaTipo === "retiro" && typeof body.sucursalRetiro === "string"
          ? body.sucursalRetiro.trim().slice(0, 20) || null
          : null;
      cuentaTransferencia = cuentaParaVistaPrevia({
        cuentas,
        datos,
        entrada: {
          entregaTipo,
          provincia: provincia || null,
          sucursalRetiro,
        },
        total: cotizacion.total,
        sucursalesActivas,
      });
    }

    return NextResponse.json({
      ...cotizacion,
      ...(cuentaTransferencia !== undefined ? { cuentaTransferencia } : {}),
      ...(disponibilidad ? { disponibilidad } : {}),
      envio: evaluarEnvio(cotizacion.subtotal, provinciaTexto, await leerConfigEnvio()),
    });
  } catch (err) {
    console.error("[/api/carrito/cotizar] error:", err);
    return NextResponse.json(
      { error: "No pudimos calcular el total. Inténtelo de nuevo en un momento." },
      { status: 502 },
    );
  }
}
