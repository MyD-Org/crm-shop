"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCart } from "@/context/CartContext";
import type { Cotizacion } from "@/lib/cotizacion";
import type { EntregaTipo, EnvioEvaluado } from "@/lib/envio";
import type { DisponibilidadVista, LocalDisponibilidad } from "@/lib/disponibilidad-textos";
import type { CuentaPagoSnapshot } from "@/lib/cuentas-bancarias";
import type { ProgresoCuotas } from "@/lib/cuotas-sin-interes";

/**
 * Cotización del carrito contra el servidor.
 *
 * El carrito y el checkout NO calculan totales: los piden. Es lo que hace que
 * el número que ve el cliente sea el mismo que se va a persistir, con precio,
 * IVA y stock leídos en vivo de Alegra.
 *
 * `import type` de lib/*: son tipos, se borran en compilación. Nada del cliente
 * de Alegra llega al bundle del browser.
 */

export interface CotizacionResponse extends Cotizacion {
  envio: EnvioEvaluado;
  /**
   * Sólo con el flag `disponibilidad-sucursal`: disponibilidad por producto (envío y retiro por
   * local) y los locales con su nombre. Ausente = flag apagado.
   */
  disponibilidad?: { productos: Record<string, DisponibilidadVista>; locales: LocalDisponibilidad[] };
  /**
   * Sólo si se pidió `conCuenta` y hay sesión: la cuenta para transferir que corresponde a la
   * entrega y al total (null = sin cuenta aplicable). El pedido la vuelve a resolver y la congela.
   */
  cuentaTransferencia?: CuentaPagoSnapshot | null;
  /**
   * Sólo si se pidió `conCuotas` (flag `cuotas-cobro`, medio con cobro en línea y condiciones): el total
   * y la cuota de cada cantidad de cuotas sin interés (1 = un pago), cada una con la lista de su
   * condición. Ausente = no hay cuotas que ofrecer.
   */
  cuotasOpciones?: { cuotas: number; total: number; montoCuota: number }[];
  /**
   * Con `conCuotas` y un monto mínimo sin alcanzar: la próxima cantidad de cuotas que se habilita y
   * cuánto falta del total (con impuestos, al precio de pago único). Ausente = nada que informar.
   */
  proximoEscalon?: { cuotas: number; falta: number };
  /** Barra de cuotas del carrito (`conProgresoCuotas`) o del medio elegido (`conCuotas`): ver `progresoCuotas`. */
  progresoCuotas?: ProgresoCuotas;
}

export type EstadoCotizacion = "vacio" | "cargando" | "ok" | "error" | "no_auth";

/**
 * Espera antes de recotizar tras un cambio.
 *
 * El `QuantityStepper` avisa en cada clic de + y −, así que subir una cantidad
 * de 1 a 20 son 20 cambios en pocos segundos. Sin esta espera, cada uno abre un
 * request que a su vez se abre en hasta 60 llamadas a Alegra, y el usuario
 * termina chocando contra el rate limit de la ruta en pleno uso normal.
 *
 * 350 ms es más corto que la pausa entre dos clics deliberados, así que quien
 * ajusta de a uno no lo percibe, y quien clickea rápido genera un solo request.
 */
const ESPERA_MS = 350;
/**
 * Ante un 429 (límite de cotizaciones por minuto) no se muestra error: el
 * límite es una protección del servidor, no algo que el cliente pueda
 * resolver. Se reintenta solo tras esta espera y, mientras tanto, los totales
 * siguen estimados como en cualquier recotización.
 */
const REINTENTO_429_MS = 5_000;

/**
 * Resultado de un fetch, etiquetado con los inputs que lo produjeron.
 *
 * Guardar los inputs junto al dato es lo que permite DERIVAR "cargando" en vez
 * de setearlo desde el efecto: si la etiqueta no coincide con los inputs
 * actuales, lo que hay en mano está viejo y todavía se está pidiendo lo nuevo.
 */
interface Resultado {
  clave: string;
  nonce: number;
  entregaTipo: EntregaTipo;
  ciudad: string;
  provincia: string;
  conCuenta: boolean;
  sucursalRetiro: string;
  listaKey: string;
  pagoMetodo: string;
  cuotas: number;
  conCuotas: boolean;
  conProgresoCuotas: boolean;
  data: CotizacionResponse | null;
  error: string | null;
  noAuth: boolean;
}

export function useCotizacion(opts: {
  entregaTipo: EntregaTipo;
  ciudad?: string;
  /**
   * Provincia de entrega elegida (clave de zona). Cambiarla recotiza: define la sucursal de la
   * zona con la que se calcula la disponibilidad (flag `disponibilidad-sucursal`).
   */
  provincia?: string;
  /**
   * Pide también la cuenta para transferir (medio Transferencia elegido). Cambiarla, o el local de
   * retiro, recotiza: la cuenta depende de la sucursal y del total.
   */
  conCuenta?: boolean;
  /** Local de retiro elegido (slug); sólo cuenta con `conCuenta` y retiro. */
  sucursalRetiro?: string;
  /**
   * Lista de precios del medio de pago elegido ('' si no tiene). Es lo que dispara el refetch al
   * cambiar de medio (no el slug): medios sin lista o con la misma lista comparten cotización.
   */
  listaKey?: string;
  /** Slug canónico del medio para esa lista (ver `pagoParaCotizar`); el servidor resuelve la lista desde él. */
  pagoMetodo?: string;
  /** Cuotas sin interés elegidas (1 = un pago). Cambiarlas recotiza: cada cantidad es otra lista. */
  cuotas?: number;
  /** Pide también el total y la cuota de cada cantidad (selector de cuotas del checkout). */
  conCuotas?: boolean;
  /** Pide el progreso combinado hacia más cuotas sin interés (barra del carrito; sin medio elegido). */
  conProgresoCuotas?: boolean;
  /** false para no cotizar todavía (ej. el carrito aún no se hidrató). */
  activo?: boolean;
}) {
  const { items, ready } = useCart();
  const [res, setRes] = useState<Resultado | null>(null);
  const [nonce, setNonce] = useState(0);

  const activo = opts.activo ?? true;
  const ciudad = opts.ciudad ?? "";
  const provincia = opts.provincia ?? "";
  const conCuenta = opts.conCuenta ?? false;
  const sucursalRetiro = conCuenta && opts.entregaTipo === "retiro" ? (opts.sucursalRetiro ?? "") : "";
  const listaKey = opts.listaKey ?? "";
  const pagoMetodo = listaKey ? (opts.pagoMetodo ?? "") : "";
  const cuotas = opts.cuotas ?? 1;
  const conCuotas = opts.conCuotas ?? false;
  const conProgresoCuotas = opts.conProgresoCuotas ?? false;
  const { entregaTipo } = opts;

  // Solo `id` y `qty` disparan una recotización. Sin esta clave, cualquier
  // re-render del provider (o un cambio de nombre en el catálogo) pegaría de
  // nuevo contra Alegra.
  const clave = useMemo(
    () =>
      JSON.stringify(
        items
          .map((i) => [i.id, i.qty] as const)
          .sort((a, b) => a[0].localeCompare(b[0])),
      ),
    [items],
  );

  const vacio = items.length === 0;
  /**
   * La PRIMERA cotización no espera: al abrir el carrito, 350 ms de demora
   * antes de ver los totales se notan. La espera solo tiene sentido para los
   * cambios posteriores, que son los que llegan en ráfaga.
   */
  const yaCotizo = useRef(false);

  useEffect(() => {
    if (!ready || !activo || vacio) return;

    const lineas = JSON.parse(clave) as [string, number][];
    const ctrl = new AbortController();
    const etiqueta = { clave, nonce, entregaTipo, ciudad, provincia, conCuenta, sucursalRetiro, listaKey, pagoMetodo, cuotas, conCuotas, conProgresoCuotas };
    let reintento: ReturnType<typeof setTimeout> | undefined;

    const timer = setTimeout(async () => {
      yaCotizo.current = true;
      try {
        const r = await fetch("/api/carrito/cotizar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            items: lineas.map(([id, qty]) => ({ id, qty })),
            entregaTipo,
            ciudad: ciudad || undefined,
            provincia: provincia || undefined,
            conCuenta: conCuenta || undefined,
            sucursalRetiro: sucursalRetiro || undefined,
            pagoMetodo: pagoMetodo || undefined,
            cuotas: cuotas > 1 ? cuotas : undefined,
            conCuotas: conCuotas || undefined,
            progresoCuotas: conProgresoCuotas || undefined,
          }),
        });

        if (r.status === 429) {
          if (!ctrl.signal.aborted) {
            reintento = setTimeout(() => setNonce((n) => n + 1), REINTENTO_429_MS);
          }
          return;
        }

        if (r.status === 401) {
          setRes({ ...etiqueta, data: null, error: null, noAuth: true });
          return;
        }

        const json = await r.json();

        if (!r.ok) {
          setRes({
            ...etiqueta,
            data: null,
            noAuth: false,
            error: json?.error ?? "No pudimos calcular el total.",
          });
          return;
        }

        setRes({
          ...etiqueta,
          data: json as CotizacionResponse,
          error: null,
          noAuth: false,
        });
      } catch (err) {
        // Un abort es un fetch que quedó viejo, no una falla: si se guardara
        // como error, cada tecleo en el carrito pintaría un error fantasma.
        if ((err as Error)?.name === "AbortError") return;
        setRes({
          ...etiqueta,
          data: null,
          noAuth: false,
          error: "No pudimos conectarnos. Revise su conexión.",
        });
      }
    }, yaCotizo.current ? ESPERA_MS : 0);

    // Limpiar el timer además de abortar: si el cambio llegó durante la espera,
    // el request ni siquiera se abre.
    return () => {
      clearTimeout(timer);
      clearTimeout(reintento);
      ctrl.abort();
    };
  }, [clave, ready, activo, vacio, entregaTipo, ciudad, provincia, conCuenta, sucursalRetiro, listaKey, pagoMetodo, cuotas, conCuotas, conProgresoCuotas, nonce]);

  // Estado DERIVADO de los inputs actuales vs. los del último resultado. Nada
  // de esto vive en useState: setear estado desde un efecto para algo que ya se
  // sabe en el render es una cascada de renders de más.
  const vigente =
    res !== null &&
    res.clave === clave &&
    res.nonce === nonce &&
    res.entregaTipo === entregaTipo &&
    res.ciudad === ciudad &&
    res.provincia === provincia &&
    res.conCuenta === conCuenta &&
    res.sucursalRetiro === sucursalRetiro &&
    res.listaKey === listaKey &&
    res.pagoMetodo === pagoMetodo &&
    res.cuotas === cuotas &&
    res.conCuotas === conCuotas &&
    res.conProgresoCuotas === conProgresoCuotas;

  let estado: EstadoCotizacion;
  if (vacio) estado = "vacio";
  else if (!vigente) estado = "cargando";
  else if (res.noAuth) estado = "no_auth";
  else if (res.error) estado = "error";
  else estado = "ok";

  return {
    cotizacion: estado === "ok" && vigente ? res.data : null,
    estado,
    error: vigente ? res.error : null,
    /**
     * Últimas líneas cotizadas con éxito, aunque ya no correspondan al carrito
     * actual. Sólo para ESTIMAR mientras se recotiza (ej. la barra de cuotas del
     * carrito); nunca para mostrar un total como confirmado.
     */
    ultimasLineas: res?.data?.lineas ?? null,
    /**
     * Últimas opciones de cuotas recibidas, aunque se esté recotizando: el selector no parpadea al
     * cambiar de cantidad. Los montos que valen son los de la cotización vigente.
     */
    ultimasCuotasOpciones: res?.data?.cuotasOpciones ?? null,
    /** Último progreso de cuotas recibido, aunque se esté recotizando (la barra no parpadea). */
    ultimoProgresoCuotas: res?.data?.progresoCuotas ?? null,
    /** Fuerza una recotización (botón "reintentar", o antes de confirmar). */
    recotizar: () => setNonce((n) => n + 1),
  };
}
