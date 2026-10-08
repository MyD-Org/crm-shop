/**
 * Opciones de cuotas del formulario de pago para UN pedido: junta las cuotas sin interés de la tienda
 * (ya cotizadas sobre el pedido, ver `cuotas-opciones.ts`) con los planes que Mercado Pago informa para
 * la tarjeta (`pagos/mercadopago-planes.ts`). Puro: la ruta `POST /api/pedidos/[id]/cuotas` hace el IO.
 *
 * Cada opción dice en qué cuotas tiene que quedar congelado el pedido antes de cobrar (`pedidoCuotas`):
 * N para las sin interés de la tienda (su lista de precios), 1 para el pago único y para las de Mercado
 * Pago (el pedido sigue al precio de 1 pago; el interés lo cobra MP).
 */
import { montoPorCuota, type CondicionCuotas } from "./cuotas-sin-interes";
import type { OpcionCuotasCotizada } from "./cuotas-opciones";
import { marcaPermitida } from "./pagos/marcas";
import type { PlanesMP } from "./pagos/mercadopago-planes";

export type TipoOpcionCuotas = "un_pago" | "sin_interes" | "con_interes";

export interface OpcionCuotasPedido {
  clave: string;
  cuotas: number;
  tipo: TipoOpcionCuotas;
  montoCuota: number;
  /** Lo que paga el comprador en total. */
  total: number;
  /** Cuotas en las que tiene que quedar el pedido para cobrar esta opción. */
  pedidoCuotas: number;
  /** Sólo con interés: como los informa el procesador ("169,00"). */
  cft?: string;
  tea?: string;
}

export interface CuotasRestringidas {
  cuotas: number;
  /** Ids canónicos de las marcas con las que sí se ofrece (ver `pagos/marcas.ts`). */
  marcas: string[];
}

export function combinarOpcionesCuotas(a: {
  /** 1 pago y las sin interés que alcanzan el mínimo, cotizadas sobre el pedido. */
  sinInteres: readonly OpcionCuotasCotizada[];
  /** Condiciones del medio (para las marcas de cada cantidad). */
  condiciones: readonly CondicionCuotas[];
  /** Marca de la tarjeta cargada; null = sin tarjeta o desconocida. */
  marca: string | null;
  /** Hay tarjeta cargada (BIN o marca elegida): recién ahí se avisan las cuotas restringidas. */
  tarjetaCargada: boolean;
  /** Planes de MP: de la tarjeta (con BIN) o de referencia. null = sin planes. */
  planes: PlanesMP | null;
  /** Los planes son de ESTA tarjeta (BIN): habilita el control de interés sobre las sin interés. */
  planesDeLaTarjeta: boolean;
}): { opciones: OpcionCuotasPedido[]; restringidas: CuotasRestringidas[] } {
  const opciones: OpcionCuotasPedido[] = [];
  const restringidas: CuotasRestringidas[] = [];
  const conInteresDeMP = (n: number) =>
    a.planesDeLaTarjeta && Boolean(a.planes?.planes.some((p) => p.cuotas === n && p.conInteres));

  const unPago = a.sinInteres.find((o) => o.cuotas === 1);
  if (unPago) {
    opciones.push({ clave: "un_pago-1", cuotas: 1, tipo: "un_pago", montoCuota: unPago.total, total: unPago.total, pedidoCuotas: 1 });
  }

  for (const o of a.sinInteres) {
    if (o.cuotas < 2) continue;
    const marcas = a.condiciones.find((c) => c.cuotas === o.cuotas)?.marcas ?? null;
    if (!marcaPermitida(marcas, a.marca)) {
      if (a.tarjetaCargada && marcas) restringidas.push({ cuotas: o.cuotas, marcas: [...marcas] });
      continue;
    }
    // Control (a): si MP cobra interés en esta cantidad con ESTA tarjeta, no se ofrece como sin interés
    // (la ofrece MP como con interés, más abajo).
    if (conInteresDeMP(o.cuotas)) continue;
    opciones.push({
      clave: `sin_interes-${o.cuotas}`,
      cuotas: o.cuotas,
      tipo: "sin_interes",
      montoCuota: o.montoCuota,
      total: o.total,
      pedidoCuotas: o.cuotas,
    });
  }

  for (const p of a.planes?.planes ?? []) {
    if (opciones.some((o) => o.cuotas === p.cuotas)) continue;
    if (p.conInteres) {
      opciones.push({
        clave: `con_interes-${p.cuotas}`,
        cuotas: p.cuotas,
        tipo: "con_interes",
        montoCuota: p.montoCuota,
        total: p.total,
        ...(p.cft ? { cft: p.cft } : {}),
        ...(p.tea ? { tea: p.tea } : {}),
        pedidoCuotas: 1,
      });
    } else if (unPago) {
      // Tasa 0: MP lo da sin interés a cargo del vendedor, al precio de 1 pago.
      opciones.push({
        clave: `sin_interes-${p.cuotas}`,
        cuotas: p.cuotas,
        tipo: "sin_interes",
        montoCuota: montoPorCuota(unPago.total, p.cuotas),
        total: unPago.total,
        pedidoCuotas: 1,
      });
    }
  }

  return { opciones: opciones.sort((x, y) => x.cuotas - y.cuotas), restringidas };
}
