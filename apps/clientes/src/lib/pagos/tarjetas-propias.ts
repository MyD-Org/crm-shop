/**
 * Logos propios de las tarjetas, de respaldo: si Mercado Pago no devuelve su lista (falla, sin credenciales o
 * sin tarjetas) el footer, "Ver tarjetas aceptadas", el checkout y el formulario de Payway siguen mostrando
 * logos. Con la lista de Mercado Pago no se usan: manda su API (`tarjetas-aceptadas.ts`).
 *
 * Los ids son los `payment_method_id` de Mercado Pago, para que `marcas.ts` los una por marca (así
 * `tarjetasPayway` saca de acá las cuatro marcas del convenio). Los archivos están en
 * `public/images/tarjetas/`: los mismos logos que devuelve Mercado Pago (`secure_thumbnail`), guardados en el
 * repo para no depender de su API ni de su host. Módulo PURO.
 */
import { SIN_TARJETAS, type TarjetaAceptada, type TarjetasAceptadas } from "./tarjetas-aceptadas";

const tarjeta = (id: string, nombre: string, archivo: string): TarjetaAceptada => ({ id, nombre, logo: `/images/tarjetas/${archivo}` });

/** Mismas marcas y mismo orden que mostraba Mercado Pago; crédito y débito de una marca comparten archivo. */
export const TARJETAS_PROPIAS: TarjetasAceptadas = {
  credito: [
    tarjeta("visa", "Visa", "visa.png"),
    tarjeta("master", "Mastercard", "mastercard.png"),
    tarjeta("amex", "American Express", "amex.png"),
    tarjeta("naranja", "Naranja", "naranja.svg"),
    tarjeta("cabal", "Cabal", "cabal.png"),
    tarjeta("argencard", "Argencard", "argencard.png"),
    tarjeta("diners", "Diners", "diners.png"),
  ],
  debito: [
    tarjeta("debvisa", "Visa Débito", "visa.png"),
    tarjeta("debmaster", "Mastercard Débito", "mastercard.png"),
    tarjeta("maestro", "Maestro", "maestro.png"),
    tarjeta("debcabal", "Cabal Débito", "cabal.png"),
  ],
};

/** Las tarjetas de Mercado Pago si trajo alguna; si no, las propias. */
export function conRespaldoPropio(deMercadoPago: TarjetasAceptadas | undefined): TarjetasAceptadas {
  const t = deMercadoPago ?? SIN_TARJETAS;
  return t.credito.length + t.debito.length > 0 ? t : TARJETAS_PROPIAS;
}
