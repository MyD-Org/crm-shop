import { NextResponse } from "next/server";
import { identidadActual } from "@/lib/auth";
import { catalogoSoloVisibles } from "@/lib/catalogo-flag";
import { variantesSelector } from "@/lib/variantes-flag";
import { cotizar, normalizarLineas, MAX_LINEAS } from "@/lib/cotizacion";
import { evaluarEnvio, type EntregaTipo } from "@/lib/envio";
import { leerConfigEnvio } from "@/lib/sucursales-repo";
import { permitirAsync } from "@/lib/rate-limit";
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
import { condicionAlcanzada, cuotasElegidas, montoPorCuota, progresoCuotas, proximoEscalon } from "@/lib/cuotas-sin-interes";
import { baseParaCuotasCon, opcionesSinInteresCotizadas } from "@/lib/cuotas-opciones";
import { TEXTOS_CUOTAS } from "@/lib/cuotas-textos";
import { idListaDelMedio, resolverForma } from "@/lib/lista-medio";
import type { OpcionCobro } from "@/lib/pagos/opciones-cobro";
import { procesadorConfigurado } from "@/lib/pagos";
import { esCompradorCuentaCorriente, mediosParaModalidad } from "@/lib/medios-pago";
import { listaPrivadaDelComprador } from "@/lib/lista-cuenta-repo";
import { listaDeOpcion, opcionesDePago } from "@/lib/opciones-pago";
import { idsAPedido } from "@/lib/venta-sin-stock";
import { localDeRetiro } from "@/lib/sucursales-pedido";
import { sinProcesadoresNoConfigurados } from "@/lib/medios-pago-datos";
import { listaAConfirmar } from "@/lib/medios-precio";

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
 * aplica a la modalidad, releído sin caché); el body nunca trae lista ni precios. Si el comprador
 * tiene LISTA PRIVADA (cuenta corriente con lista enlazada, resuelta en el servidor desde su sesión)
 * se ignoran el medio y las cuotas: se cotiza a su precio neto; un producto sin precio en su lista
 * sale como `sin_precio` ("Consulte") y bloquea la compra.
 * `provincia`: la de entrega (checkout) o la de la ubicación del cliente; con ella y la
 * configuración de envío releída SIN caché (`leerConfigEnvio`) se evalúa `envio` (gratis, a
 * coordinar, cuánto falta). Con el flag `disponibilidad-sucursal` también define la sucursal de la
 * zona con la que se calcula la disponibilidad; con el flag prendido la respuesta suma
 * `disponibilidad` (envío y retiro por local, por producto).
 *
 * Totales del carrito leídos del catálogo del CRM (vista `catalog_products_shop` y, con lista
 * privada, `catalog_products_shop_privados`), sin llamadas a Alegra. El carrito y el
 * checkout muestran lo que devuelve esta ruta, no lo que tienen en memoria, y
 * `POST /api/pedidos` registra el mismo número. Ver src/lib/cotizacion.ts.
 *
 * Sin sesión también cotiza: con la lista principal (L1), la misma que ve en
 * el catálogo y la misma que usa un cliente todavía no vinculado. Así el
 * visitante ve el IVA y el total final antes de iniciar sesión; para comprar
 * la sesión sigue siendo obligatoria (checkout y `POST /api/pedidos`).
 *
 * Venta sin stock por modalidad: la respuesta suma `flujo`. Con el flag `disponibilidad-sucursal`
 * la disponibilidad se calcula ANTES de cotizar y decide qué líneas van a pedido (`aPedido`, el
 * mismo motor que el pedido). Un carrito `a_confirmar` (sin cuenta corriente ni lista privada) se
 * cotiza con la lista que muestran las cards (`listaAConfirmar`) y no trae cuotas, totales por
 * opción, barra de cuotas ni cuenta de transferencia: no se cobra en línea.
 */
export async function POST(req: Request) {
  const { clerkUserId, cliente } = await identidadActual();

  const quien = clerkUserId ?? cliente?.codigocliente;
  const permitido = quien
    ? await permitirAsync(`cotizar:${quien}`, MAX_POR_MINUTO, 60_000)
    : await permitirAsync(`cotizar:ip:${ipDe(req) ?? "desconocida"}`, MAX_POR_MINUTO_VISITANTE, 60_000);
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
    progresoCuotas?: unknown;
    precioLineas?: unknown;
    conCuotas?: unknown;
    forma?: unknown;
    totalesOpciones?: unknown;
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
      flujo: "normal",
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
    // Lista privada del comprador: sólo desde su sesión. Anónimo o sin lista ⇒ null (precio público).
    const idListaPrivada = cliente ? await listaPrivadaDelComprador() : null;
    // Lista del medio elegido (servidor, desde el slug). Sin medio, o con lista privada (el precio ya
    // no depende del medio), no hay lista de medio: carrito y retiro cotizan como siempre.
    const pagoMetodo = typeof body.pagoMetodo === "string" ? body.pagoMetodo.trim().slice(0, 40) : "";
    // Cuenta corriente: su único medio es el de su audiencia, sin cuotas ni lista por medio. Con
    // lista privada tampoco aplica la lista del medio ni las cuotas.
    const esCuentaCorriente = esCompradorCuentaCorriente(cliente);
    const conMedio = Boolean(pagoMetodo) && !esCuentaCorriente && !idListaPrivada;
    const mediosCrm = conMedio ? await leerMediosPagoTolerante() : [];
    // Cuotas sin interés: sólo con el flag y un medio con cobro en línea. Cada cantidad es otra lista.
    const medioCobro = mediosParaModalidad(mediosCrm, entregaTipo).find((m) => m.slug === pagoMetodo);
    const conCuotas = Boolean(conMedio && medioCobro?.cobroOnline && (await cuotasHabilitadas()));
    // Forma de pago de la pestaña o modalidad activa (change `listas-por-forma-de-pago`): solo con un
    // medio de cobro en línea. Sin forma, o sin precios distintos por forma, rige la lista del medio.
    let forma: OpcionCobro | null = null;
    if (conMedio && medioCobro?.cobroOnline) {
      const f = resolverForma(medioCobro, body.forma);
      if (!f.ok) {
        return NextResponse.json(
          { error: "Esa forma de pago no está disponible para este medio.", motivo: "forma_no_disponible" },
          { status: 400 },
        );
      }
      forma = f.forma;
      // Las cuotas sin interés son de crédito.
      if (typeof body.cuotas === "number" && body.cuotas >= 2 && f.pedida && f.pedida !== "credito") {
        return NextResponse.json(
          { error: TEXTOS_CUOTAS.cuotasNoDisponibles, motivo: "cuotas_no_disponibles" },
          { status: 422 },
        );
      }
    }
    // Flag `disponibilidad-sucursal`: stock por sucursal (unión) y disponibilidad por modalidad.
    const base = await dispDelVisitante();
    const provincia = provinciaTexto ? claveProvincia(provinciaTexto) : "";
    const disp = base ? await contextoParaProvincia(base, provincia || null) : undefined;
    const soloVisibles = await catalogoSoloVisibles();
    // Flag `variantes-selector`: el overlay (visibilidad) es el del ancla del grupo. Apagado = como siempre.
    const agrupar = await variantesSelector();
    const sucursalRetiro =
      entregaTipo === "retiro" && typeof body.sucursalRetiro === "string"
        ? body.sucursalRetiro.trim().slice(0, 20) || null
        : null;
    // Con el flag, la disponibilidad va PRIMERO: decide qué líneas van a pedido con las reglas reales
    // (`origenDeLinea`), no con la unión permisiva. null (flag apagado o falla) = decide el stock.
    const disponibilidad = await disponibilidadParaMostrar(
      lineas.map((l) => l.id),
      disp,
      Object.fromEntries(lineas.map((l) => [l.id, l.qty])),
      agrupar,
    );
    let aPedido: Set<string> | undefined;
    if (disponibilidad) {
      const local =
        entregaTipo === "retiro"
          ? (sucursalRetiro ??
            localDeRetiro({ entregaTipo, provincia: provincia || null, sucursalRetiro }, await sucursalesCacheadas()))
          : null;
      aPedido = idsAPedido(disponibilidad.productos, { tipo: entregaTipo, local });
    }
    const opcionesCotizar = {
      soloVisibles,
      ...(agrupar ? { agrupar: true } : {}),
      idListaPrivada,
      entregaTipo,
      disp: disp ? contextoUnion(disp) : undefined,
      ...(aPedido ? { aPedido } : {}),
    };
    // Monto mínimo por cantidad de cuotas: la base es el total con impuestos a la lista del PAGO ÚNICO
    // del medio. Sólo se cotiza si hay algún mínimo cargado y se pidieron cuotas u opciones.
    const hayMinimos = (medioCobro?.condicionesCuotas ?? []).some((c) => c.montoMinimo != null);
    const pideCuotas = typeof body.cuotas === "number" && body.cuotas >= 2;
    // Base de un medio: cotización a la lista de su pago único y, si esa lista no sirve (el medio no
    // tiene o un producto no tiene precio en ella), a la de referencia. null = no se pudo calcular:
    // nunca se promete con base 0.
    const cotizarConLista = (idListaMedio: string | undefined) => cotizar(lineas, { ...opcionesCotizar, idListaMedio });
    const baseDelMedio = (medios: typeof mediosCrm, slug: string, formaBase?: OpcionCobro | null): Promise<number | null> =>
      baseParaCuotasCon(cotizarConLista, idListaDelMedio(medios, entregaTipo, slug, undefined, 1, formaBase), "/api/carrito/cotizar");
    // `totalBase` valida el mínimo (0 si no se pudo: sólo las cantidades sin mínimo); `baseValida`
    // habilita barra y "sume": sólo con una base real.
    let totalBase: number | undefined;
    let baseValida = false;
    if (conCuotas && hayMinimos && (pideCuotas || body.conCuotas === true)) {
      // Las cuotas son de crédito: su mínimo se mide sobre el pago único de esa forma.
      const b = await baseDelMedio(mediosCrm, pagoMetodo, forma ? "credito" : null);
      totalBase = b ?? 0;
      baseValida = b !== null;
    }
    let cuotas = 1;
    if (conCuotas) {
      const elegidas = cuotasElegidas(body.cuotas, medioCobro?.condicionesCuotas, totalBase);
      if (!elegidas.ok) {
        return NextResponse.json(
          { error: TEXTOS_CUOTAS.cuotasNoDisponibles, motivo: "cuotas_no_disponibles" },
          { status: 422 },
        );
      }
      cuotas = elegidas.cuotas;
    }
    const idListaMedio = conMedio ? idListaDelMedio(mediosCrm, entregaTipo, pagoMetodo, undefined, cuotas, forma) : undefined;
    let cotizacion = await cotizar(lineas, { ...opcionesCotizar, idListaMedio });
    // Pedido a confirmar por modalidad: no se cobra en línea y el precio es el de las cards (también
    // en las líneas con stock). Cuenta corriente y lista privada siguen con su precio.
    const aConfirmar = cotizacion.flujo === "a_confirmar" && !esCuentaCorriente && !idListaPrivada;
    if (aConfirmar) {
      const lista = listaAConfirmar(sinProcesadoresNoConfigurados(await leerMediosPagoTolerante()));
      cotizacion = await cotizar(lineas, { ...opcionesCotizar, idListaMedio: lista });
    }
    // Selector del checkout: el total de cada cantidad de cuotas es el de SU lista (varias cotizaciones
    // en paralelo, sólo con `conCuotas`). Los montos salen del servidor, nunca del navegador. Sólo las
    // cantidades cuyo mínimo alcanza la base.
    const cuotasOpciones =
      !aConfirmar && conCuotas && body.conCuotas === true && medioCobro
        ? await opcionesSinInteresCotizadas({
            condiciones: medioCobro.condicionesCuotas,
            // Un pago: la lista del pago único del medio (o la de referencia si no tiene).
            idListaUnPago: idListaDelMedio(mediosCrm, entregaTipo, pagoMetodo, undefined, 1, forma),
            totalBase,
            cotizarConLista,
          })
        : undefined;
    // "Le faltan $X para N cuotas": sólo con las opciones pedidas (checkout) y algún mínimo sin alcanzar.
    const escalon =
      !aConfirmar && conCuotas && body.conCuotas === true && baseValida && totalBase !== undefined
        ? proximoEscalon(medioCobro?.condicionesCuotas, totalBase)
        : null;
    // Barra del carrito: sin medio elegido, el progreso combinado entre los medios de cobro en línea
    // elegibles (cada uno con su base). Sin cuenta corriente, lista privada ni flag: nada.
    let progreso: ReturnType<typeof progresoCuotas> = null;
    let mediosProgreso: { condiciones: typeof mediosCrm[number]["condicionesCuotas"]; base: number }[] = [];
    // A confirmar: sin cobro en línea no hay cuotas que promover.
    if (!aConfirmar && body.progresoCuotas === true && !conMedio && !esCuentaCorriente && !idListaPrivada && (await cuotasHabilitadas())) {
      const todos = await leerMediosPagoTolerante();
      const medios = mediosParaModalidad(todos, entregaTipo, { procesadorDisponible: procesadorConfigurado }).filter(
        (m) => m.cobroOnline && (m.condicionesCuotas ?? []).some((c) => c.montoMinimo != null),
      );
      if (medios.length > 0) {
        const bases = (
          await Promise.all(
            medios.map(async (m) => ({ condiciones: m.condicionesCuotas, base: await baseDelMedio(todos, m.slug) })),
          )
        ).filter((b): b is { condiciones: typeof b.condiciones; base: number } => b.base !== null);
        if (bases.length > 0) {
          mediosProgreso = bases;
          progreso = progresoCuotas(bases);
        }
      }
    } else if (!aConfirmar && conCuotas && body.conCuotas === true && baseValida && totalBase !== undefined) {
      mediosProgreso = [{ condiciones: medioCobro?.condicionesCuotas, base: totalBase }];
      progreso = progresoCuotas(mediosProgreso);
    }
    // Monto de cada cuota del nivel ya alcanzado: el total de ESTA compra a la lista de esa condición
    // dividido N. Si no se puede calcular, la barra informa sólo la cantidad (nunca un monto inventado).
    if (progreso && progreso.cuotasActuales !== null) {
      const alcanzada = condicionAlcanzada(mediosProgreso, progreso.cuotasActuales);
      if (alcanzada) {
        try {
          const q = await cotizar(lineas, { ...opcionesCotizar, idListaMedio: alcanzada.idListaPrecios });
          if (!q.hayProblemas && q.total > 0) {
            progreso = {
              ...progreso,
              montoCuota: montoPorCuota(q.total, alcanzada.cuotas),
              // La ficha pide los totales por línea para calcular la cuota de su producto.
              ...(body.precioLineas === true
                ? { lineasAlcanzada: q.lineas.map((l) => ({ id: l.id, qty: l.qty, total: l.total })) }
                : {}),
            };
          }
        } catch (err) {
          console.error("[/api/carrito/cotizar] monto de la cuota alcanzada:", err);
        }
      }
    }
    // Vista previa de la cuenta de la transferencia (sólo con identidad: el checkout exige
    // sesión). Se resuelve con lecturas cacheadas y el total cotizado; el pedido la vuelve a
    // resolver sin caché y la congela.
    let cuentaTransferencia: Awaited<ReturnType<typeof cuentaParaVistaPrevia>> | undefined;
    if (!aConfirmar && body.conCuenta === true && !esCuentaCorriente && (clerkUserId || cliente)) {
      const [cuentas, datos, sucursalesActivas] = await Promise.all([
        cuentasBancariasCacheadas(),
        sucursalesCacheadas(),
        sucursalesHabilitadas(),
      ]);
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

    // Paso Pago del checkout (`totalesOpciones: true`): el total de cada card (forma de pago), una
    // cotización por lista distinta. Cuenta corriente y lista privada no eligen medio: nada.
    let totalesOpciones: Record<string, number | null> | undefined;
    if (!aConfirmar && body.totalesOpciones === true && !esCuentaCorriente && !idListaPrivada) {
      const medios = mediosParaModalidad(mediosCrm.length > 0 ? mediosCrm : await leerMediosPagoTolerante(), entregaTipo, {
        procesadorDisponible: procesadorConfigurado,
      });
      const opciones = opcionesDePago(medios);
      const listas = [...new Set(opciones.map((o) => listaDeOpcion(medios, o)))];
      const porLista = new Map(
        await Promise.all(
          listas.map(async (l): Promise<[string, number | null]> => {
            try {
              const q = await cotizarConLista(l || undefined);
              return [l, q.hayProblemas ? null : q.total];
            } catch (err) {
              console.error("[/api/carrito/cotizar] total de una opción de pago:", err);
              return [l, null];
            }
          }),
        ),
      );
      totalesOpciones = Object.fromEntries(opciones.map((o) => [o.clave, porLista.get(listaDeOpcion(medios, o)) ?? null]));
    }

    return NextResponse.json({
      ...cotizacion,
      ...(totalesOpciones ? { totalesOpciones } : {}),
      ...(cuotasOpciones ? { cuotasOpciones } : {}),
      ...(escalon ? { proximoEscalon: escalon } : {}),
      ...(progreso ? { progresoCuotas: progreso } : {}),
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
