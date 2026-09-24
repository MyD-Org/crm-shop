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

/** País del documento. Define qué documentos se ofrecen y cómo se validan. */
export type Pais = "AR" | "BR" | "PY";

export const PAIS_LABEL: Record<Pais, string> = {
  AR: "Argentina",
  BR: "Brasil",
  PY: "Paraguay",
};

export const PAIS_DEFAULT: Pais = "AR";

export type TipoDoc = "CUIT" | "DNI" | "CPF" | "CNPJ" | "CI" | "RUC";

/**
 * Rótulo visible del tipo de documento. El valor guardado sigue siendo "CUIT":
 * CUIT y CUIL comparten formato y dígito verificador, y MercadoPago y los
 * pedidos leen ese valor tal cual.
 */
export const TIPO_DOC_LABEL: Record<TipoDoc, string> = {
  CUIT: "CUIT / CUIL",
  DNI: "DNI",
  CPF: "CPF",
  CNPJ: "CNPJ",
  CI: "Cédula de identidad",
  RUC: "RUC",
};

/**
 * Documentos de cada país: el de la empresa primero y el de la persona después.
 *
 * El orden importa: el primero es el criterio más estricto del país, y es con
 * el que se valida un número que llega sin `tipoDoc` (ver `validarFacturacion`).
 */
export const TIPOS_DOC_POR_PAIS: Record<Pais, TipoDoc[]> = {
  AR: ["CUIT", "DNI"],
  BR: ["CNPJ", "CPF"],
  PY: ["RUC", "CI"],
};

/**
 * Solo se envía dentro de Argentina. A un comprador con documento de otro país
 * se le factura igual (factura B), pero retira o coordina la entrega.
 */
export function admiteEnvio(pais: string | null | undefined): boolean {
  return (pais ?? PAIS_DEFAULT) === "AR";
}

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
  pais: Pais;
  tipoDoc: TipoDoc;
  nroDoc: string;
  razonSocial: string;
  condicionIva: CondicionIva;
  domicilioCalle?: string;
  domicilioCiudad?: string;
  domicilioProvincia?: string;
  domicilioCp?: string;
  /** Teléfono de contacto. Opcional en el perfil; el checkout lo exige. */
  telefono?: string;
}

/**
 * ¿Parece un teléfono? Se cuenta solo los dígitos: entre 8 (un fijo con
 * característica) y 15 (el tope internacional). No se valida más que eso —
 * la gente lo escribe con "+", espacios, guiones o paréntesis y todo eso
 * tiene que pasar. El dato es para que un operador llame, no para marcar solo.
 */
export function telefonoValido(raw: string): boolean {
  const digitos = soloDigitos(raw);
  return digitos.length >= 8 && digitos.length <= 15;
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

/**
 * CPF brasileño: 11 dígitos, los dos últimos verificadores (módulo 11).
 *
 * Las secuencias de un mismo dígito (111.111.111-11) pasan la cuenta pero la
 * Receita no las emite: se rechazan aparte.
 */
export function cpfValido(raw: string): boolean {
  const cpf = soloDigitos(raw);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;

  const verificador = (largo: number) => {
    let suma = 0;
    for (let i = 0; i < largo; i++) suma += Number(cpf[i]) * (largo + 1 - i);
    const resto = suma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  return verificador(9) === Number(cpf[9]) && verificador(10) === Number(cpf[10]);
}

/** Deja letras y dígitos en mayúscula: el CNPJ nuevo es alfanumérico. */
function soloAlfanumerico(v: string): string {
  return v.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/**
 * CNPJ brasileño: 14 posiciones, las dos últimas verificadores numéricos.
 *
 * Desde julio de 2026 la Receita emite CNPJ **alfanuméricos**: las primeras 12
 * posiciones pueden traer letras. La cuenta es la misma de siempre tomando cada
 * carácter como su código ASCII menos 48, así que un dígito vale lo que valía y
 * los CNPJ numéricos viejos siguen validando igual.
 */
export function cnpjValido(raw: string): boolean {
  const cnpj = soloAlfanumerico(raw);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^0+$/.test(cnpj)) return false;

  const verificador = (largo: number) => {
    let suma = 0;
    let peso = 2;
    for (let i = largo - 1; i >= 0; i--) {
      suma += (cnpj.charCodeAt(i) - 48) * peso;
      peso = peso === 9 ? 2 : peso + 1;
    }
    const resto = suma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  return verificador(12) === Number(cnpj[12]) && verificador(13) === Number(cnpj[13]);
}

/** Cédula de identidad paraguaya: sin dígito verificador, entre 5 y 8 dígitos. */
export function ciParaguayValida(raw: string): boolean {
  const ci = soloDigitos(raw);
  return ci.length >= 5 && ci.length <= 8 && !/^0+$/.test(ci);
}

/**
 * RUC paraguayo: número base + un dígito verificador (módulo 11, como lo
 * calcula la SET). Se escribe "80012345-6"; acá llega ya sin el guion.
 */
export function rucParaguayValido(raw: string): boolean {
  const ruc = soloDigitos(raw);
  if (ruc.length < 6 || ruc.length > 9 || /^0+$/.test(ruc)) return false;

  const base = ruc.slice(0, -1);
  let suma = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    suma += Number(base[i]) * peso;
    peso = peso === 11 ? 2 : peso + 1;
  }
  const resto = suma % 11;
  const verificador = resto > 1 ? 11 - resto : 0;

  return verificador === Number(ruc[ruc.length - 1]);
}

const VALIDADOR_DOC: Record<TipoDoc, (raw: string) => boolean> = {
  CUIT: cuitValido,
  DNI: dniValido,
  CPF: cpfValido,
  CNPJ: cnpjValido,
  CI: ciParaguayValida,
  RUC: rucParaguayValido,
};

/**
 * Normaliza el número para guardarlo y compararlo: sin guiones, puntos ni
 * espacios. Solo el CNPJ conserva letras.
 */
export function normalizarDoc(tipoDoc: TipoDoc, raw: string): string {
  return tipoDoc === "CNPJ" ? soloAlfanumerico(raw) : soloDigitos(raw);
}

/** Formatea el documento para mostrar. Hoy solo el CUIT tiene formato propio. */
export function formatearDoc(tipoDoc: TipoDoc, raw: string): string {
  return tipoDoc === "CUIT" ? formatearCuit(raw) : raw;
}

/**
 * Forma escrita de cada documento: largo de cada grupo y separador que lo sigue.
 *
 * El DNI y la cédula paraguaya no llevan guiones. El RUC sí, pero su número
 * base no tiene largo fijo (de 5 a 8 dígitos): mientras se tipea no se puede
 * saber dónde va el guion, así que se resuelve al terminar (ver `alSalir`).
 */
const MASCARA_DOC: Partial<Record<TipoDoc, { grupos: number[]; separadores: string[] }>> = {
  CUIT: { grupos: [2, 8, 1], separadores: ["-", "-"] },
  CPF: { grupos: [3, 3, 3, 2], separadores: [".", ".", "-"] },
  CNPJ: { grupos: [2, 3, 3, 4, 2], separadores: [".", ".", "/", "-"] },
};

/**
 * Pone los guiones y puntos del documento mientras se escribe.
 *
 * Un separador aparece recién cuando hay un carácter **después** de él: "20"
 * queda "20" y "203" pasa a "20-3". Si apareciera apenas se completa el grupo,
 * borrar hacia atrás sería una trampa — se borra el guion, se vuelve a
 * formatear, el guion reaparece, y el usuario no puede pasar de ahí.
 *
 * Descarta lo que sobra del largo del documento, así no se puede tipear de más.
 *
 * `alSalir` es para el blur: ahí se da por terminado el número y se puede
 * poner el guion del RUC, que va siempre antes del último dígito.
 */
export function formatearDocAlEscribir(
  tipoDoc: TipoDoc,
  raw: string,
  { alSalir = false }: { alSalir?: boolean } = {},
): string {
  const limpio = normalizarDoc(tipoDoc, raw);

  if (tipoDoc === "RUC") {
    const ruc = limpio.slice(0, 9);
    return alSalir && ruc.length >= 6 ? `${ruc.slice(0, -1)}-${ruc.slice(-1)}` : ruc;
  }

  const mascara = MASCARA_DOC[tipoDoc];
  // DNI: hasta 8 dígitos. Cédula paraguaya: ídem. Sin separadores.
  if (!mascara) return limpio.slice(0, 8);

  let salida = "";
  let desde = 0;
  mascara.grupos.forEach((largo, i) => {
    const grupo = limpio.slice(desde, desde + largo);
    if (!grupo) return;
    salida += (i > 0 ? mascara.separadores[i - 1] : "") + grupo;
    desde += largo;
  });
  return salida;
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

  // Sin país se asume Argentina: es el default del servidor y de los perfiles
  // guardados antes de que existiera el campo.
  const pais = datos.pais ?? PAIS_DEFAULT;
  const esArgentina = pais === "AR";
  if (!(pais in PAIS_LABEL)) {
    errores.pais = "Seleccione un país.";
  }

  // La condición frente al IVA es un concepto argentino: a un extranjero no se
  // le pregunta, y el servidor la guarda como consumidor final.
  const condicion = datos.condicionIva;
  if (esArgentina && (!condicion || !(condicion in CONDICION_IVA_LABEL))) {
    errores.condicionIva = "Elija su condición frente al IVA.";
  }

  if (!datos.razonSocial?.trim()) {
    errores.razonSocial = !esArgentina
      ? "Ingrese el nombre y apellido o la razón social."
      : condicion === "consumidor_final"
        ? "Ingrese su nombre y apellido."
        : "Ingrese la razón social.";
  }

  const tipoDoc = datos.tipoDoc;
  const tiposDelPais = TIPOS_DOC_POR_PAIS[pais] ?? TIPOS_DOC_POR_PAIS[PAIS_DEFAULT];

  if (tipoDoc && !tiposDelPais.includes(tipoDoc)) {
    errores.tipoDoc = "Ese documento no corresponde al país elegido.";
  } else if (
    esArgentina &&
    condicion &&
    EXIGEN_CUIT.includes(condicion) &&
    tipoDoc !== "CUIT"
  ) {
    errores.tipoDoc = `Con ${CONDICION_IVA_LABEL[condicion].toLowerCase()} hace falta CUIT.`;
  }

  /**
   * El número se valida SIEMPRE, en su propia cadena.
   *
   * Antes esto colgaba del mismo `else if` que el error de tipoDoc, y eso
   * abría dos huecos: con el tipo de documento mal elegido el número no se
   * miraba, y —peor— si `tipoDoc` venía sin definir no entraba en ninguna rama
   * y un documento como "123" salía sin un solo error. Esta función recibe un
   * `Partial<DatosFacturacion>`, así que ese caso no es hipotético: es lo que
   * la firma invita a pasarle.
   *
   * Sin `tipoDoc` —o con uno que no es del país— se valida con el primero del
   * país, que es el criterio más estricto (CUIT en Argentina, el default del
   * servidor). Nunca dejar pasar un documento sin mirar.
   */
  const tipoParaValidar =
    tipoDoc && tiposDelPais.includes(tipoDoc) ? tipoDoc : tiposDelPais[0];
  const nro = normalizarDoc(tipoParaValidar, datos.nroDoc ?? "");
  if (!nro) {
    errores.nroDoc = "Ingrese su número de documento.";
  } else if (!VALIDADOR_DOC[tipoParaValidar](nro)) {
    errores.nroDoc =
      tipoParaValidar === "DNI"
        ? "Ese DNI no es válido."
        : `El número de ${TIPO_DOC_LABEL[tipoParaValidar]} no es válido. Revise los números.`;
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
    errores.domicilioCalle = "Ingrese el domicilio fiscal.";
  }
  if (!datos.domicilioCiudad?.trim()) {
    errores.domicilioCiudad = "Ingrese la ciudad.";
  }

  // El teléfono no frena el guardado del perfil (el checkout lo pide igual),
  // pero si vino algo, tiene que parecer un teléfono: "123" guardado hoy es
  // un pedido sin contacto mañana.
  const telefono = datos.telefono?.trim();
  if (telefono && !telefonoValido(telefono)) {
    errores.telefono = "Ingrese un teléfono válido, con código de área.";
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

/**
 * Documento de un contacto de Alegra para mostrar: "CUIT 20-12345678-9" si
 * tiene 11 dígitos, si no "documento 39282165" (Alegra no dice el tipo y un DNI
 * rotulado como CUIT confunde).
 */
export function documentoEnLinea(raw: string): string {
  const digitos = soloDigitos(raw);
  return digitos.length === 11 ? `CUIT ${formatearCuit(digitos)}` : `documento ${raw.trim()}`;
}
