import type { PlanDeCuotas } from "../cuotas-tipos";

/** Resultado de consultar un medio: los planes o por qué falló. */
export type ResultadoPlanesMedio =
  | { medio: string; ok: true; planes: PlanDeCuotas[] }
  | { medio: string; ok: false; error: string };

/**
 * Adaptador de un proveedor de pagos para obtener sus planes de cuotas reales.
 * Agregar un proveedor = un adaptador nuevo; motor y UI no cambian.
 */
export interface ProveedorCuotas {
  /** 'mercadopago'. Coincide con `MedioDePago.proveedor`. */
  id: string;
  /**
   * Marcas de crédito a consultar ('visa', 'master'). La config del CRM es por
   * proveedor; el snapshot se guarda por marca y el motor las junta.
   */
  mediosPorDefecto: string[];
  /**
   * Planes normalizados para los medios pedidos ('visa', 'master').
   *
   * Ante un fallo total (error o timeout en todos los medios) MUST tirar: nunca
   * devolver `[]` como si fuera una respuesta válida, porque la sync pisaría la
   * última copia buena con vacío.
   */
  obtenerPlanes(medios: string[]): Promise<PlanDeCuotas[]>;
  /**
   * Igual que `obtenerPlanes` pero informa el resultado de cada medio, para
   * que la sync actualice cada fila por separado (fallo parcial → `last_error`
   * sólo en el medio caído). Nunca tira.
   */
  obtenerPlanesPorMedio(medios: string[]): Promise<ResultadoPlanesMedio[]>;
}
