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
import { leerMediosPagoTolerante } from "@/lib/medios-pago-repo";
import { cuotasHabilitadas } from "@/lib/cuotas-flag";
import { cuotasElegidas, repartirCuotas } from "@/lib/cuotas-sin-interes";
import { TEXTOS_CUOTAS } from "@/lib/cuotas-textos";
import { idListaDelMedio } from "@/lib/lista-medio";
import { mediosParaModalidad } from "@/lib/medios-pago";
import { precioEspecialCuenta } from "@/lib/precio-especial-flag";

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
 * Body: { items: [{ id, qty }], entregaTipo?, provincia?, pagoMetodo? }
 * `cuotas` (flag `cuotas-cobro`, sólo medio con cobro en línea): cuotas sin interés elegidas; cotiza con
 * la lista de esa condición y se rechaza (422) una cantidad sin condición. `conCuotas: true` (checkout)
 * suma `cuotasOpciones`: total y cuota de cada cantidad (1 pago incluido), cada una con la lista de SU
 * condición.
 * `pagoMetodo`: slug del medio de pago elegido. La lista de precios sale SOLO de ahí (medio activo que
 * aplica a la modalidad, releído sin caché); el body nunca trae lista ni precios. Con el flag
 * `precio-especial-cuenta` prendido se ignora y rige la lista propia del cliente.
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
    pagoMetodo?: unknown;
    cuotas?: unknown;
    conCuotas?: unknown;
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
    // Lista del medio elegido (servidor, desde el slug). Sin medio, o con el flag del precio
    // especial prendido, no hay lista de medio: carrito y retiro cotizan como siempre.
    const pagoMetodo = typeof body.pagoMetodo === "string" ? body.pagoMetodo.trim().slice(0, 40) : "";
    const sinMedioEspecial = pagoMetodo && !(await precioEspecialCuenta());
    const mediosCrm = sinMedioEspecial ? await leerMediosPagoTolerante() : [];
    // Cuotas sin interés: sólo con el flag y un medio con cobro en línea. Cada cantidad es otra lista.
    const medioCobro = mediosParaModalidad(mediosCrm, entregaTipo).find((m) => m.slug === pagoMetodo);
    const conCuotas = Boolean(sinMedioEspecial && medioCobro?.cobroOnline && (await cuotasHabilitadas()));
    let cuotas = 1;
    if (conCuotas) {
      const elegidas = cuotasElegidas(body.cuotas, medioCobro?.condicionesCuotas);
      if (!elegidas.ok) {
        return NextResponse.json(
          { error: TEXTOS_CUOTAS.cuotasNoDisponibles, motivo: "cuotas_no_disponibles" },
          { status: 422 },
        );
      }
      cuotas = elegidas.cuotas;
    }
    const idListaMedio = sinMedioEspecial ? idListaDelMedio(mediosCrm, entregaTipo, pagoMetodo, undefined, cuotas) : undefined;
    // Flag `disponibilidad-sucursal`: stock por sucursal (unión) y disponibilidad por modalidad.
    const base = await dispDelVisitante();
    const provincia = provinciaTexto ? claveProvincia(provinciaTexto) : "";
    const disp = base ? await contextoParaProvincia(base, provincia || null) : undefined;
    const soloVisibles = await catalogoSoloVisibles();
    const opcionesCotizar = { soloVisibles, idPriceList, entregaTipo, disp: disp ? contextoUnion(disp) : undefined };
    const cotizacion = await cotizar(lineas, { ...opcionesCotizar, idListaMedio });
    // Selector del checkout: el total de cada cantidad de cuotas es el de SU lista (varias cotizaciones
    // en paralelo, sólo con `conCuotas`). Los montos salen del servidor, nunca del navegador.
    const cuotasOpciones =
      conCuotas && body.conCuotas === true && medioCobro
        ? (
            await Promise.all(
              [
                // Un pago: la lista del pago único del medio (o la de referencia si no tiene).
                { cuotas: 1, idListaPrecios: idListaDelMedio(mediosCrm, entregaTipo, pagoMetodo, undefined, 1) },
                ...(medioCobro.condicionesCuotas ?? []),
              ].map(async (c) => {
                const q = await cotizar(lineas, { ...opcionesCotizar, idListaMedio: c.idListaPrecios });
                if (q.hayProblemas || !(q.total > 0)) return null;
                const partes = repartirCuotas(q.total, c.cuotas);
                return {
                  cuotas: c.cuotas,
                  total: q.total,
                  montoCuota: partes[partes.length - 1],
                  primeraCuota: partes[0],
                };
              }),
            )
          )
            .filter((o): o is NonNullable<typeof o> => o !== null)
            .sort((a, b) => a.cuotas - b.cuotas)
        : undefined;
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
      ...(cuotasOpciones ? { cuotasOpciones } : {}),
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
