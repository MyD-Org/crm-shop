/**
 * Flag `mercadopago` (ver src/flags.ts): decide si el Shop ofrece y acepta Mercado Pago, aunque el
 * medio esté activo en el admin. Sirve para probar el cobro en producción con un solo usuario (regla
 * por `user.email` en Vercel Flags) antes de abrirlo a todos.
 *
 * Dos evaluaciones:
 * - `mediosSegunComprador`: con la identidad de Clerk. Va donde el comprador elige o cambia el medio
 *   (checkout, crear pedido, cambiar medio, cotizar).
 * - `mediosSegunPublico`: sin identidad (lo que ve cualquier visitante). Va en lo público y cacheable
 *   (precios "con X" de las cards, Envíos y pagos): ahí Mercado Pago aparece sólo si el flag está
 *   prendido para todos.
 *
 * Lo que pasa después de elegir (cobro, webhook, avisos, Mi cuenta) no se filtra: un pedido creado
 * con Mercado Pago se sigue cobrando aunque el flag se apague.
 */
import { mercadopagoFlag } from "@/flags";
import { SLUG_MERCADOPAGO } from "./medios-pago";

function sinMercadoPago<T extends { slug: string }>(medios: readonly T[]): T[] {
  return medios.filter((m) => m.slug !== SLUG_MERCADOPAGO);
}

async function evaluar(conIdentidad: boolean): Promise<boolean> {
  try {
    return conIdentidad ? await mercadopagoFlag() : await mercadopagoFlag.run({ identify: {} });
  } catch (err) {
    console.warn("[mercadopago-flag] no se pudo evaluar; Mercado Pago queda apagado:", err instanceof Error ? err.message : err);
    return false;
  }
}

/** Los medios que puede elegir el comprador del request. */
export async function mediosSegunComprador<T extends { slug: string }>(medios: readonly T[]): Promise<T[]> {
  if (!medios.some((m) => m.slug === SLUG_MERCADOPAGO)) return [...medios];
  return (await evaluar(true)) ? [...medios] : sinMercadoPago(medios);
}

/** Los medios que ve cualquier visitante. */
export async function mediosSegunPublico<T extends { slug: string }>(medios: readonly T[]): Promise<T[]> {
  if (!medios.some((m) => m.slug === SLUG_MERCADOPAGO)) return [...medios];
  return (await evaluar(false)) ? [...medios] : sinMercadoPago(medios);
}
