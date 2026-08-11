"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCart } from "@/context/CartContext";
import type { Cotizacion } from "@/lib/cotizacion";
import type { EntregaTipo, PagoMetodo } from "@/lib/envio";

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
  envio: { disponible: boolean; motivo?: string };
  pagosDisponibles: PagoMetodo[];
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
  data: CotizacionResponse | null;
  error: string | null;
  noAuth: boolean;
}

export function useCotizacion(opts: {
  entregaTipo: EntregaTipo;
  ciudad?: string;
  /** false para no cotizar todavía (ej. el carrito aún no se hidrató). */
  activo?: boolean;
}) {
  const { items, ready } = useCart();
  const [res, setRes] = useState<Resultado | null>(null);
  const [nonce, setNonce] = useState(0);

  const activo = opts.activo ?? true;
  const ciudad = opts.ciudad ?? "";
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
    const etiqueta = { clave, nonce, entregaTipo, ciudad };

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
          }),
        });

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
          error: "No pudimos conectarnos. Revisá tu conexión.",
        });
      }
    }, yaCotizo.current ? ESPERA_MS : 0);

    // Limpiar el timer además de abortar: si el cambio llegó durante la espera,
    // el request ni siquiera se abre.
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [clave, ready, activo, vacio, entregaTipo, ciudad, nonce]);

  // Estado DERIVADO de los inputs actuales vs. los del último resultado. Nada
  // de esto vive en useState: setear estado desde un efecto para algo que ya se
  // sabe en el render es una cascada de renders de más.
  const vigente =
    res !== null &&
    res.clave === clave &&
    res.nonce === nonce &&
    res.entregaTipo === entregaTipo &&
    res.ciudad === ciudad;

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
    /** Fuerza una recotización (botón "reintentar", o antes de confirmar). */
    recotizar: () => setNonce((n) => n + 1),
  };
}
