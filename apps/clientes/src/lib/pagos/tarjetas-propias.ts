/**
 * Logos propios de las tarjetas, de respaldo: si Mercado Pago no devuelve su lista (falla, sin credenciales o
 * sin tarjetas) el footer, "Ver tarjetas aceptadas", el checkout y el formulario de Payway siguen mostrando
 * logos. Con la lista de Mercado Pago no se usan: manda su API (`tarjetas-aceptadas.ts`).
 *
 * Los ids son los `payment_method_id` de Mercado Pago, para que `marcas.ts` los una por marca (así
 * `tarjetasPayway` saca de acá las cuatro marcas del convenio). Los archivos están en
 * `public/images/tarjetas/`: marcas simplificadas, propias del repo (sin hosts externos). Para usar el arte
 * oficial de una marca basta reemplazar su SVG con el mismo nombre. Módulo PURO.
 */
import { SIN_TARJETAS, type TarjetaAceptada, type TarjetasAceptadas } from "./tarjetas-aceptadas";

const logo = (marca: string) => `/images/tarjetas/${marca}.svg`;
const tarjeta = (id: string, nombre: string, marca: string): TarjetaAceptada => ({ id, nombre, logo: logo(marca) });

/** Mismas marcas y mismo orden que mostraba Mercado Pago; crédito y débito de una marca comparten archivo. */
export const TARJETAS_PROPIAS: TarjetasAceptadas = {
  credito: [
    tarjeta("visa", "Visa", "visa"),
    tarjeta("master", "Mastercard", "mastercard"),
    tarjeta("amex", "American Express", "amex"),
    tarjeta("naranja", "Naranja", "naranja"),
    tarjeta("cabal", "Cabal", "cabal"),
    tarjeta("argencard", "Argencard", "argencard"),
    tarjeta("diners", "Diners", "diners"),
  ],
  debito: [
    tarjeta("debvisa", "Visa Débito", "visa"),
    tarjeta("debmaster", "Mastercard Débito", "mastercard"),
    tarjeta("maestro", "Maestro", "maestro"),
    tarjeta("debcabal", "Cabal Débito", "cabal"),
  ],
};

/** Las tarjetas de Mercado Pago si trajo alguna; si no, las propias. */
export function conRespaldoPropio(deMercadoPago: TarjetasAceptadas | undefined): TarjetasAceptadas {
  const t = deMercadoPago ?? SIN_TARJETAS;
  return t.credito.length + t.debito.length > 0 ? t : TARJETAS_PROPIAS;
}
