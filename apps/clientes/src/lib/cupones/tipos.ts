// Tipos de los cupones de descuento en el Shop (spec apps/admin/docs/superpowers/specs/2026-11-01-cupones-design.md).
import type { EntregaTipo } from "../envio";
import type { OpcionCobro } from "../pagos/opciones-cobro";

/**
 * Foto del cupón que congela el pedido (`orders.cupon`, migración 0042). Lleva lo necesario para
 * recotizar (cambio de medio y cuotas) sin volver a leer la promoción: el pedido conserva su
 * descuento aunque la promoción se pause o venza. `descuento` es con IVA (la línea del resumen).
 */
export interface CuponPedido {
  codigoId: string;
  codigo: string;
  promocionId: string;
  nombre: string;
  pct: number | null;
  envioGratis: boolean;
  provinciasEnvio: string[] | null;
  medios: string[] | null;
  formas: OpcionCobro[] | null;
  permiteCuotas: boolean;
  condiciones: string;
  descuento: number;
  /**
   * Resultado congelado al crear: ¿el envío gratis del cupón valió para esta entrega? La entrega no
   * cambia después, así que al recotizar se usa esto y no la regla (el pedido no guarda la provincia).
   * Ausente = foto anterior: se recotiza con la regla.
   */
  envioGratisAplicado?: boolean;
  /** ¿El envío era gratis también por la regla de la tienda? Si el pedido pierde el cupón, decide `envio_gratis`. */
  envioGratisTienda?: boolean;
}

/** Lo que el Shop lee de la vista `public.cupones_shop` (CRM 0097) para un código. */
export interface PromocionCupon {
  codigoId: string;
  codigo: string;
  promocionId: string;
  nombre: string;
  tipo: "generica" | "unicos";
  pct: number | null;
  envioGratis: boolean;
  /** Claves de `claveProvincia`; NULL = donde la tienda ya hace envío a domicilio. */
  provinciasEnvio: string[] | null;
  inicio: string;
  /** Exclusivo. */
  fin: string;
  /** Vencimiento del código (únicos con "vence a los N días"); NULL = sólo la vigencia. */
  venceEn: string | null;
  soloPrimeraCompra: boolean;
  /** Con IVA, sobre todo el carrito a la lista general. */
  minimo: number | null;
  medios: string[] | null;
  formas: OpcionCobro[] | null;
  permiteCuotas: boolean;
  limiteCanjes: number | null;
  condiciones: string;
  activa: boolean;
}

export type MotivoCupon =
  | "no_existe"
  | "vencido"
  | "no_empezo"
  | "usado"
  | "no_primera_compra"
  | "minimo"
  | "todo_en_campania"
  | "lista_privada"
  | "agotado"
  | "solo_envio"
  | "sin_sesion"
  | "opcion_no_elegible"
  | "no_disponible";

/** El cupón aplicado a una cotización. */
export interface CuponAplicado {
  codigo: string;
  codigoId: string;
  promocionId: string;
  nombre: string;
  pct: number | null;
  /** false = el % no alcanzó ninguna línea (todo en campaña) y queda sólo el envío gratis. */
  pctAplicado: boolean;
  /** El envío gratis del cupón vale para esta entrega. */
  envioGratis: boolean;
  /** Con IVA: diferencia de `total` antes y después. */
  descuento: number;
  /** Neto ANTES del cupón: la regla de envío gratis de la tienda se evalúa sobre éste. */
  subtotalAntes: number;
  condiciones: string;
  venceEn: string | null;
  /** false = invitado: faltan las reglas de la cuenta (primera compra, lista privada). */
  verificado: boolean;
  aviso: string | null;
}

export interface CuponError {
  motivo: MotivoCupon;
  mensaje: string;
}

/** Lo que eligió el comprador para pagar: decide si el cupón es elegible. */
export interface OpcionCupon {
  slug: string;
  forma: OpcionCobro | null;
  cuotasSinInteres: boolean;
  /** El medio tiene formas (Mercado Pago, Payway): sin `forma` conocida, una promoción con formas no aplica. */
  conFormas?: boolean;
}

export interface ContextoCupon {
  ahora: Date;
  /** null = todavía no eligió cómo pagar (carrito): se aplica y se avisa la restricción de pago. */
  opcion: OpcionCupon | null;
  entrega: { tipo: EntregaTipo; provincia: string | null };
  /** Total con IVA de todo el carrito a la lista general, SIN el costo de envío (para el mínimo). */
  totalListaGeneral: number;
  /**
   * ¿El envío resuelto admite que un cupón de envío gratis anule la tarifa? false = el método por zona
   * no aplica gratis (`gratis_aplica` apagado): el cupón no anula el envío. Ausente = true (sin método
   * por zona el envío es siempre a coordinar o gratis, como antes).
   */
  envioGratisAplica?: boolean;
  /** Primer motivo de la cuenta que impide el cupón (`motivoCuentaCupon`), o null. */
  motivoCuenta: MotivoCupon | null;
  verificado: boolean;
  /** Recotización de un pedido ya creado: se saltean vigencia, mínimo y cuenta. */
  congelado: boolean;
  /** slug → nombre visible del medio (de `medios_pago_shop`), para el texto de `opcion_no_elegible`. */
  nombresMedios?: Record<string, string>;
}

/** Lo que reciben `cotizarConMedio` y `/api/carrito/cotizar` para aplicar un cupón. */
export interface CuponParaCotizar {
  promo: PromocionCupon;
  motivoCuenta: MotivoCupon | null;
  verificado: boolean;
  congelado?: boolean;
}
