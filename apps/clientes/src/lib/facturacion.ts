/**
 * Datos de facturación del comprador.
 *
 * Distinción central (ver también el comentario de `billing_profiles` en el
 * schema): el CUIT de acá es **un dato de la factura**, no un reclamo de
 * identidad. Se tipea libremente y no otorga nada — ni lista de precios ni
 * cuenta corriente. Para eso está la vinculación por OTP (`src/lib/vinculacion.ts`).
 *
 * Módulo PURO: solo tipos y validaciones, sin DB ni Alegra. Lo importa el
 * formulario (client component), y en Next un import arrastra el módulo
 * entero — si acá viviera `getDb`, Turbopack intentaría meter `postgres` en el
 * bundle del navegador y el build falla. La persistencia está en
 * `facturacion-db.ts`.
 */

export type TipoDoc = "CUIT" | "DNI";
export type CondicionIva =
  | "consumidor_final"
  | "monotributo"
  | "responsable_inscripto";

export const CONDICION_IVA_LABEL: Record<CondicionIva, string> = {
  consumidor_final: "Consumidor final",
  monotributo: "Monotributo",
  responsable_inscripto: "Responsable inscripto",
};

/**
 * Condiciones que exigen CUIT. Un monotributista o un responsable inscripto no
 * pueden facturar con DNI: AFIP necesita la CUIT para el comprobante.
 */
const EXIGEN_CUIT: CondicionIva[] = ["monotributo", "responsable_inscripto"];

export interface DatosFacturacion {
  tipoDoc: TipoDoc;
  nroDoc: string;
  razonSocial: string;
  condicionIva: CondicionIva;
  domicilioCalle?: string;
  domicilioCiudad?: string;
  domicilioProvincia?: string;
  domicilioCp?: string;
}

/** Deja solo dígitos: la gente escribe el CUIT con guiones, puntos y espacios. */
export function soloDigitos(v: string): string {
  return v.replace(/\D/g, "");
}

/**
 * Verifica el dígito verificador de una CUIT (módulo 11).
 *
 * Vale la pena aunque parezca detalle: un CUIT con un dígito mal tipeado pasa
 * cualquier validación de longitud, llega a la factura, y el error se descubre
 * cuando AFIP rechaza el comprobante — o peor, cuando el cliente no puede
 * computar el crédito fiscal.
 */
export function cuitValido(raw: string): boolean {
  const cuit = soloDigitos(raw);
  if (cuit.length !== 11) return false;
  // Un CUIT de ceros pasa el módulo 11 pero no existe.
  if (/^0+$/.test(cuit)) return false;

  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, peso, i) => acc + peso * Number(cuit[i]), 0);
  const resto = suma % 11;
  const verificador = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto;

  return verificador === Number(cuit[10]);
}

/** DNI argentino: entre 7 y 8 dígitos. */
export function dniValido(raw: string): boolean {
  const dni = soloDigitos(raw);
  return dni.length >= 7 && dni.length <= 8 && !/^0+$/.test(dni);
}

/** Formatea una CUIT para mostrar: 30712345678 → 30-71234567-8. */
export function formatearCuit(raw: string): string {
  const d = soloDigitos(raw);
  if (d.length !== 11) return raw;
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}

/**
 * Valida un juego de datos de facturación. Devuelve los errores por campo para
 * que el formulario pueda marcarlos donde corresponde, en vez de un mensaje
 * genérico arriba de todo.
 */
export function validarFacturacion(
  datos: Partial<DatosFacturacion>,
): Record<string, string> {
  const errores: Record<string, string> = {};

  const condicion = datos.condicionIva;
  if (!condicion || !(condicion in CONDICION_IVA_LABEL)) {
    errores.condicionIva = "Elegí tu condición frente al IVA.";
  }

  if (!datos.razonSocial?.trim()) {
    errores.razonSocial =
      condicion === "consumidor_final"
        ? "Ingresá tu nombre y apellido."
        : "Ingresá la razón social.";
  }

  const tipoDoc = datos.tipoDoc;
  const nro = soloDigitos(datos.nroDoc ?? "");

  if (condicion && EXIGEN_CUIT.includes(condicion) && tipoDoc !== "CUIT") {
    errores.tipoDoc = `Con ${CONDICION_IVA_LABEL[condicion].toLowerCase()} hace falta CUIT.`;
  } else if (!nro) {
    errores.nroDoc = "Ingresá tu número de documento.";
  } else if (tipoDoc === "CUIT" && !cuitValido(nro)) {
    errores.nroDoc = "Ese CUIT no es válido. Revisá los números.";
  } else if (tipoDoc === "DNI" && !dniValido(nro)) {
    errores.nroDoc = "Ese DNI no es válido.";
  }

  // Domicilio obligatorio para TODOS, no solo para quien discrimina IVA.
  //
  // La regla de AFIP para factura B es por MONTO, no por condición fiscal: por
  // debajo de cierto importe se puede emitir a "Consumidor Final" sin
  // identificar a nadie, pero por encima hay que consignar nombre, documento y
  // domicilio. Con un mínimo de $100.000 para envío gratis, superar ese umbral
  // acá es lo normal. Pedirlo siempre evita tener que salir a buscar el dato
  // justo cuando hay que emitir el comprobante.
  if (!datos.domicilioCalle?.trim()) {
    errores.domicilioCalle = "Ingresá el domicilio fiscal.";
  }
  if (!datos.domicilioCiudad?.trim()) {
    errores.domicilioCiudad = "Ingresá la ciudad.";
  }

  return errores;
}

/** Domicilio en una línea, como va en la factura. */
export function domicilioEnLinea(d: {
  domicilioCalle?: string | null;
  domicilioCiudad?: string | null;
  domicilioProvincia?: string | null;
  domicilioCp?: string | null;
}): string {
  return [
    d.domicilioCalle,
    d.domicilioCiudad,
    d.domicilioProvincia,
    d.domicilioCp ? `CP ${d.domicilioCp}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}
