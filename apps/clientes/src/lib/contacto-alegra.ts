/**
 * Datos de facturación de un contacto de Alegra (change `contacto-fuente-unica`).
 *
 * Módulo PURO — sin base ni Alegra — para poder testearlo en node y para que lo
 * importen componentes de cliente (el modal valida con `validarComplemento`
 * antes de mandar). Lo usan:
 *  - `datos-del-contacto.ts`: lectura única (checkout, pedidos y Mis datos).
 *  - `contacto-write-through.ts`: PUT a Alegra "sólo vacíos" + espejo al día.
 *
 * Reglas de fondo:
 *  - D1: el Shop sólo COMPLETA campos vacíos en Alegra; nunca cambia un valor
 *    presente. Se controla acá (`validarComplemento`, `armarPutSoloVacios`) y
 *    otra vez en la base (función `shop_contacto_write_through` del CRM).
 *  - D2: el perfil del Shop complementa al espejo sólo si su documento es el
 *    mismo (`mezclarConPerfil`).
 *  - Lo que viene de Alegra no se revalida cruzado: un documento que no cuadra
 *    con la condición no traba la compra, marca el pedido para revisión (R5).
 */

import {
  CONDICION_IVA_LABEL,
  cuitValido,
  dniValido,
  domicilioEnLinea,
  exigeCuit,
  normalizarDoc,
  soloDigitos,
  telefonoValido,
  type CondicionIva,
  type TipoDoc,
} from "./facturacion";
import { provinciaCanonica } from "./provincias";

export type CampoFacturacion =
  | "tipoDoc"
  | "nroDoc"
  | "razonSocial"
  | "condicionIva"
  | "domicilioCalle"
  | "domicilioCiudad"
  | "domicilioProvincia"
  | "domicilioCp";

export const CAMPOS_FACTURACION: CampoFacturacion[] = [
  "tipoDoc",
  "nroDoc",
  "razonSocial",
  "condicionIva",
  "domicilioCalle",
  "domicilioCiudad",
  "domicilioProvincia",
  "domicilioCp",
];

/** Requeridos para facturar. Provincia y CP son opcionales: nunca faltan. */
export const REQUERIDOS: CampoFacturacion[] = [
  "tipoDoc",
  "nroDoc",
  "razonSocial",
  "condicionIva",
  "domicilioCalle",
  "domicilioCiudad",
];

const OPCIONALES: CampoFacturacion[] = ["domicilioProvincia", "domicilioCp"];

export type MotivoRevision = "documento_incompatible" | "condicion_iva_desconocida";

/**
 * Un contacto tal como lo necesita la facturación: la fila de la vista
 * `alegra_contacts_shop` (columnas generadas de la migración 0034 del CRM) o un
 * contacto leído en vivo, mapeado con `contactoDeAlegra`. Vacío ⇒ null.
 */
export interface ContactoFacturacion {
  alegraId: string;
  name: string | null;
  /** `raw.identification` (texto libre de Alegra). */
  identification: string | null;
  /** Sólo dígitos de `identification` (lo calcula el CRM). */
  identificationNorm: string | null;
  identificationType: string | null;
  identificationNumber: string | null;
  ivaCondition: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressProvince: string | null;
  addressPostalCode: string | null;
  /**
   * Teléfonos del contacto (vista 0036 del CRM / GET en vivo), tal cual los
   * cargó la sucursal. Opcionales: no son de facturación y hay quien arma un
   * contacto sin ellos (tests, contacto vacío) ⇒ ausente = vacío.
   */
  phonePrimary?: string | null;
  phoneSecondary?: string | null;
  mobile?: string | null;
}

/** Datos de facturación leídos (parciales: lo que falta no está). */
export interface DatosContacto {
  /** El vinculado es siempre argentino: Alegra no guarda país. */
  pais: "AR";
  tipoDoc?: TipoDoc;
  /** Tal como está en Alegra (con o sin guiones). */
  nroDoc?: string;
  razonSocial?: string;
  condicionIva?: CondicionIva;
  /** Valor crudo de Alegra (p. ej. "IVA_EXEMPT" o uno desconocido). */
  condicionIvaAlegra?: string | null;
  domicilioCalle?: string;
  domicilioCiudad?: string;
  domicilioProvincia?: string;
  domicilioCp?: string;
}

export interface LecturaContacto {
  datos: DatosContacto;
  /** Presentes en Alegra (o deducidos del espejo): el Shop no los cambia. */
  bloqueados: CampoFacturacion[];
  /** Requeridos que faltan. */
  faltantes: CampoFacturacion[];
  completo: boolean;
  motivoRevision: MotivoRevision | null;
  /** El tipo de documento no está en Alegra: lo dedujo el Shop (R4-bis). */
  tipoDocDeducido: boolean;
  /** Documento normalizado (dígitos) para comparar con el perfil (D2). */
  documentoNorm: string | null;
}

// ---------------------------------------------------------------------------
// Mapeos
// ---------------------------------------------------------------------------

const IVA_ALEGRA_A_SHOP: Record<string, CondicionIva> = {
  FINAL_CONSUMER: "consumidor_final",
  IVA_RESPONSABLE: "responsable_inscripto",
  UNIQUE_TRIBUTE_RESPONSABLE: "monotributo",
  IVA_EXEMPT: "exento",
};

const IVA_SHOP_A_ALEGRA: Record<CondicionIva, string> = {
  consumidor_final: "FINAL_CONSUMER",
  responsable_inscripto: "IVA_RESPONSABLE",
  monotributo: "UNIQUE_TRIBUTE_RESPONSABLE",
  exento: "IVA_EXEMPT",
};

/** Condición del Shop para un valor de Alegra; null si falta o no se conoce. */
export function condicionDeAlegra(v: string | null | undefined): CondicionIva | null {
  return (v && IVA_ALEGRA_A_SHOP[v]) || null;
}

export function condicionAAlegra(c: CondicionIva): string {
  return IVA_SHOP_A_ALEGRA[c];
}

const esCondicion = (v: unknown): v is CondicionIva =>
  typeof v === "string" && v in CONDICION_IVA_LABEL;

/** Tipos que el Shop reconoce en `identificationObject.type`. */
const TIPOS_ALEGRA: TipoDoc[] = ["CUIT", "CUIL", "DNI"];

function textoONull(v: unknown): string | null {
  if (typeof v === "number") return String(v);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function objeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Un contacto crudo de Alegra (GET /contacts/{id}) con el MISMO mapeo que las
 * columnas generadas del CRM: `NULLIF(btrim(...), '')`, y `address` que no es
 * objeto cuenta como vacío.
 */
export function contactoDeAlegra(c: Record<string, unknown>): ContactoFacturacion {
  const ident = c.identification;
  const identObj = objeto(ident);
  // Igual que `mapRawContactRow` del CRM: string/number tal cual, objeto → number.
  const identification = textoONull(identObj ? identObj.number : ident);
  const io = objeto(c.identificationObject);
  const address = objeto(c.address);
  return {
    alegraId: String(c.id ?? ""),
    name: textoONull(c.name),
    identification,
    identificationNorm: identification ? soloDigitos(identification) || null : null,
    identificationType: textoONull(io?.type),
    identificationNumber: textoONull(io?.number),
    ivaCondition: textoONull(c.ivaCondition),
    addressStreet: textoONull(address?.address),
    addressCity: textoONull(address?.city),
    addressProvince: textoONull(address?.province),
    addressPostalCode: textoONull(address?.postalCode),
    phonePrimary: textoONull(c.phonePrimary),
    phoneSecondary: textoONull(c.phoneSecondary),
    mobile: textoONull(c.mobile),
  };
}

// ---------------------------------------------------------------------------
// Teléfono (el espejo es la fuente: el Shop no pide lo que ya está)
// ---------------------------------------------------------------------------

/** Los teléfonos del contacto en Alegra; vacío o espacios ⇒ null. */
export interface TelefonosContacto {
  mobile: string | null;
  phonePrimary: string | null;
  phoneSecondary: string | null;
}

export function telefonosDelContacto(
  c: Pick<ContactoFacturacion, "mobile" | "phonePrimary" | "phoneSecondary">,
): TelefonosContacto {
  return {
    mobile: textoONull(c.mobile),
    phonePrimary: textoONull(c.phonePrimary),
    phoneSecondary: textoONull(c.phoneSecondary),
  };
}

/**
 * El teléfono para contactar al comprador por un pedido: celular, si no el
 * principal, si no el secundario. `null` = Alegra no tiene ninguno (se pide en
 * el checkout, y lo que se tipea se sube a Alegra).
 */
export function telefonoPreferido(
  c: Pick<ContactoFacturacion, "mobile" | "phonePrimary" | "phoneSecondary">,
): string | null {
  const t = telefonosDelContacto(c);
  return t.mobile ?? t.phonePrimary ?? t.phoneSecondary;
}

/**
 * El teléfono tipeado, listo para subir a Alegra (recortado), o `null` si no
 * parece un teléfono (mismas reglas que Mis datos: 8 a 15 dígitos). Un valor
 * dudoso no se escribe en la fuente de verdad: queda sólo en el pedido.
 */
export function telefonoParaAlegra(tipeado: string | null | undefined): string | null {
  const t = (tipeado ?? "").trim().slice(0, 40);
  return t && telefonoValido(t) ? t : null;
}

/**
 * Teléfono del checkout: precargado con el de Alegra (vinculado) o, si no hay,
 * con el del perfil. `deSuCuenta` ⇒ no hace falta tipearlo: si el campo queda
 * vacío, el servidor usa el de Alegra.
 */
export function telefonoDelCheckout({
  telefonoAlegra,
  telefonoPerfil,
}: {
  telefonoAlegra: string | null | undefined;
  telefonoPerfil: string | null | undefined;
}): { inicial: string; deSuCuenta: boolean } {
  const alegra = textoONull(telefonoAlegra);
  if (alegra) return { inicial: alegra, deSuCuenta: true };
  return { inicial: textoONull(telefonoPerfil) ?? "", deSuCuenta: false };
}

/**
 * Los teléfonos de Alegra para mostrar en Mis datos (sólo los cargados, en el
 * orden en que se usan para un pedido). Vacío ⇒ Alegra no tiene ninguno.
 */
export function telefonosParaMostrar(t: TelefonosContacto | null | undefined): { label: string; valor: string }[] {
  if (!t) return [];
  const filas: { label: string; valor: string | null }[] = [
    { label: "Celular", valor: textoONull(t.mobile) },
    { label: "Teléfono", valor: textoONull(t.phonePrimary) },
    { label: "Teléfono alternativo", valor: textoONull(t.phoneSecondary) },
  ];
  return filas.filter((f): f is { label: string; valor: string } => f.valor !== null);
}

/** ¿El checkout tiene un teléfono para el pedido? El tipeado o el de Alegra. */
export function hayTelefonoParaPedido(tipeado: string, telefonoAlegra: string | null | undefined): boolean {
  return tipeado.trim() !== "" || Boolean(textoONull(telefonoAlegra));
}

// ---------------------------------------------------------------------------
// Tipo de documento (R4-bis)
// ---------------------------------------------------------------------------

/**
 * Tipo de documento cuando Alegra no lo tiene (914 contactos en prod).
 *
 * - Condición que exige CUIT (RI, monotributo, exento) ⇒ CUIT, que tiene que
 *   ser válido (11 dígitos y módulo 11). Si no lo es ⇒ `incompatible`, y el tipo
 *   que se congela es el que dan los dígitos (7–8 ⇒ DNI) o, si no, CUIT.
 * - Consumidor final, sin condición o condición desconocida, con 11 dígitos:
 *   prefijo 30/33/34 ⇒ CUIT; 20/23/24/27 ⇒ CUIL. Otro prefijo ⇒ no se deduce.
 *   Acá NO se exige el verificador: lo que está en Alegra no se revalida y un
 *   consumidor final no necesita CUIT para comprar; exigirlo dejaría al
 *   comprador trabado con un número que no puede cambiar desde la tienda.
 * - 7–8 dígitos ⇒ DNI.
 * - Otra cosa ⇒ `tipo: null` (el modal pide el tipo, con el número a la vista).
 */
export function deducirTipoDoc({
  condicion,
  numero,
}: {
  condicion: string | null | undefined;
  numero: string | null | undefined;
}): { tipo: TipoDoc | null; incompatible: boolean } {
  const digitos = soloDigitos(numero ?? "");
  if (!digitos) return { tipo: null, incompatible: false };
  const porLargo: TipoDoc | null = dniValido(digitos) ? "DNI" : null;

  if (exigeCuit(condicion)) {
    return cuitValido(digitos)
      ? { tipo: "CUIT", incompatible: false }
      : { tipo: porLargo ?? "CUIT", incompatible: true };
  }
  if (digitos.length === 11) {
    const prefijo = digitos.slice(0, 2);
    if (["30", "33", "34"].includes(prefijo)) return { tipo: "CUIT", incompatible: false };
    if (["20", "23", "24", "27"].includes(prefijo)) return { tipo: "CUIL", incompatible: false };
    return { tipo: null, incompatible: false };
  }
  return { tipo: porLargo, incompatible: false };
}

/** ¿Un documento (tipo + número de Alegra) sirve para una condición que exige CUIT? */
function documentoSirveParaCuit(tipo: TipoDoc | undefined, numero: string | undefined): boolean {
  return (tipo === "CUIT" || tipo === "CUIL") && cuitValido(numero ?? "");
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/** Faltantes y completo a partir de los datos (con la regla de incompatibles). */
function evaluar(
  datos: DatosContacto,
  motivoRevision: MotivoRevision | null,
): Pick<LecturaContacto, "faltantes" | "completo"> {
  const incompatible = motivoRevision === "documento_incompatible";
  const presente = (c: CampoFacturacion) =>
    c === "condicionIva"
      ? Boolean(datos.condicionIva || datos.condicionIvaAlegra)
      : Boolean(datos[c]);
  const faltantes = REQUERIDOS.filter(
    (c) =>
      !presente(c) &&
      // Documento incompatible: tipo, número y condición existen en Alegra y D1
      // impide cambiarlos desde la tienda. No se piden; revisa la sucursal.
      !(incompatible && (c === "tipoDoc" || c === "nroDoc" || c === "condicionIva")),
  );
  return { faltantes, completo: faltantes.length === 0 };
}

/** Lee los datos de facturación de un contacto (espejo o en vivo). */
export function leerContacto(c: ContactoFacturacion): LecturaContacto {
  const numero = c.identificationNumber ?? c.identification ?? undefined;
  const condicion = condicionDeAlegra(c.ivaCondition);
  const condicionDesconocida = Boolean(c.ivaCondition) && !condicion;

  let tipoDoc: TipoDoc | undefined;
  let tipoDocDeducido = false;
  let incompatible = false;
  const tipoAlegra = TIPOS_ALEGRA.find((t) => t === c.identificationType?.toUpperCase());

  if (numero) {
    if (tipoAlegra) {
      tipoDoc = tipoAlegra;
      incompatible = exigeCuit(condicion) && !documentoSirveParaCuit(tipoAlegra, numero);
    } else {
      const d = deducirTipoDoc({ condicion, numero });
      tipoDoc = d.tipo ?? undefined;
      tipoDocDeducido = d.tipo !== null;
      incompatible = d.incompatible;
    }
  }

  const datos: DatosContacto = {
    pais: "AR",
    ...(tipoDoc ? { tipoDoc } : {}),
    ...(numero ? { nroDoc: numero } : {}),
    ...(c.name ? { razonSocial: c.name } : {}),
    ...(condicion ? { condicionIva: condicion } : {}),
    condicionIvaAlegra: c.ivaCondition,
    ...(c.addressStreet ? { domicilioCalle: c.addressStreet } : {}),
    ...(c.addressCity ? { domicilioCiudad: c.addressCity } : {}),
    ...(c.addressProvince ? { domicilioProvincia: c.addressProvince } : {}),
    ...(c.addressPostalCode ? { domicilioCp: c.addressPostalCode } : {}),
  };

  const motivoRevision: MotivoRevision | null = incompatible
    ? "documento_incompatible"
    : condicionDesconocida
      ? "condicion_iva_desconocida"
      : null;

  const bloqueados = CAMPOS_FACTURACION.filter((campo) =>
    campo === "condicionIva" ? Boolean(c.ivaCondition) : Boolean(datos[campo]),
  );

  return {
    datos,
    bloqueados,
    ...evaluar(datos, motivoRevision),
    motivoRevision,
    tipoDocDeducido,
    documentoNorm: c.identificationNorm ?? (numero ? soloDigitos(numero) || null : null),
  };
}

// ---------------------------------------------------------------------------
// Mezcla con el perfil (D2)
// ---------------------------------------------------------------------------

/** Lo que se lee de `shop.billing_profiles` (columnas nullables desde 0009). */
export interface PerfilParaMezcla {
  pais?: string | null;
  tipoDoc?: string | null;
  nroDoc?: string | null;
  razonSocial?: string | null;
  condicionIva?: string | null;
  domicilioCalle?: string | null;
  domicilioCiudad?: string | null;
  domicilioProvincia?: string | null;
  domicilioCp?: string | null;
}

/** ¿El perfil tiene el mismo documento que el contacto? (D2) */
export function mismoDocumento(lectura: LecturaContacto, perfil: PerfilParaMezcla | null): boolean {
  if (!perfil || !lectura.documentoNorm) return false;
  if ((perfil.pais ?? "AR") !== "AR") return false;
  if (!perfil.tipoDoc || !perfil.nroDoc) return false;
  return normalizarDoc(perfil.tipoDoc as TipoDoc, perfil.nroDoc) === lectura.documentoNorm;
}

const CAMPOS_DEL_PERFIL: CampoFacturacion[] = [
  "razonSocial",
  "condicionIva",
  "domicilioCalle",
  "domicilioCiudad",
  "domicilioProvincia",
  "domicilioCp",
];

/**
 * Completa los vacíos del contacto con el perfil, SÓLO si es el mismo
 * documento. Nunca pisa un valor presente ni aporta el documento (si el
 * espejo no tiene número, no hay con qué comparar). `aporto` = campos que
 * salieron del perfil (fuente "mixto").
 */
export function mezclarConPerfil(
  lectura: LecturaContacto,
  perfil: PerfilParaMezcla | null,
): { lectura: LecturaContacto; aporto: CampoFacturacion[] } {
  if (!mismoDocumento(lectura, perfil)) return { lectura, aporto: [] };
  const datos: DatosContacto = { ...lectura.datos };
  const aporto: CampoFacturacion[] = [];

  for (const campo of CAMPOS_DEL_PERFIL) {
    const valor = perfil?.[campo]?.trim();
    if (!valor) continue;
    if (campo === "condicionIva") {
      if (datos.condicionIva || datos.condicionIvaAlegra || !esCondicion(valor)) continue;
      datos.condicionIva = valor;
    } else {
      if (datos[campo]) continue;
      (datos as unknown as Record<string, string>)[campo] = valor;
    }
    aporto.push(campo);
  }

  let motivoRevision = lectura.motivoRevision;
  // La condición del perfil cambia la deducción de un tipo que Alegra no tenía.
  if (aporto.includes("condicionIva") && lectura.tipoDocDeducido) {
    const d = deducirTipoDoc({ condicion: datos.condicionIva, numero: datos.nroDoc });
    if (d.tipo) datos.tipoDoc = d.tipo;
    if (d.incompatible) motivoRevision = "documento_incompatible";
  }

  return {
    lectura: { ...lectura, datos, motivoRevision, ...evaluar(datos, motivoRevision) },
    aporto,
  };
}

// ---------------------------------------------------------------------------
// Complemento tipeado en el modal
// ---------------------------------------------------------------------------

export type Complemento = Partial<Record<CampoFacturacion, string>>;

export type ResultadoComplemento =
  | { ok: true; complemento: Complemento; datos: DatosContacto }
  | { ok: false; motivo: "campo_de_alegra"; campos: CampoFacturacion[] }
  | { ok: false; motivo: "invalido"; errores: Partial<Record<CampoFacturacion, string>> };

const LARGO_MAX: Record<CampoFacturacion, number> = {
  tipoDoc: 10,
  nroDoc: 20,
  razonSocial: 160,
  condicionIva: 40,
  domicilioCalle: 160,
  domicilioCiudad: 80,
  domicilioProvincia: 80,
  domicilioCp: 12,
};

const comparable = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();

function mismoValor(campo: CampoFacturacion, tipeado: string, actual: DatosContacto): boolean {
  if (campo === "nroDoc") return soloDigitos(tipeado) === soloDigitos(actual.nroDoc ?? "");
  if (campo === "condicionIva") {
    return tipeado === actual.condicionIva || tipeado === actual.condicionIvaAlegra;
  }
  if (campo === "domicilioProvincia") {
    const a = actual.domicilioProvincia ?? "";
    return (provinciaCanonica(tipeado) ?? comparable(tipeado)) === (provinciaCanonica(a) ?? comparable(a));
  }
  return comparable(tipeado) === comparable(String(actual[campo] ?? ""));
}

const MENSAJE_FALTA: Record<CampoFacturacion, string> = {
  tipoDoc: "Seleccione el tipo de documento.",
  nroDoc: "Ingrese su número de documento.",
  razonSocial: "Ingrese la razón social o su nombre y apellido.",
  condicionIva: "Elija su condición frente al IVA.",
  domicilioCalle: "Ingrese el domicilio fiscal.",
  domicilioCiudad: "Ingrese la ciudad.",
  domicilioProvincia: "Seleccione una provincia de la lista.",
  domicilioCp: "Ingrese el código postal.",
};

/**
 * Valida lo que el comprador vinculado cargó en el modal contra lo que ya
 * tiene Alegra. D1 en el servidor:
 *  1. Un campo presente con OTRO valor ⇒ `campo_de_alegra` (antes que nada:
 *     no se llama a Alegra). Con el mismo valor se ignora.
 *  2. Sólo se aceptan los faltantes y los opcionales vacíos (provincia, CP);
 *     cualquier otra clave se ignora.
 *  3. Se exigen TODOS los faltantes requeridos (R9).
 *  4. CUIT válido si se tipea; RI/monotributo/exento exigen CUIT (también
 *     cuando la condición se carga sobre un documento que ya está en Alegra).
 *  5. Provincia opcional, de la lista oficial; se guarda con su nombre.
 */
export function validarComplemento(
  lectura: LecturaContacto,
  entrada: Record<string, unknown>,
): ResultadoComplemento {
  const tipeado: Complemento = {};
  for (const campo of CAMPOS_FACTURACION) {
    const v = entrada[campo];
    if (typeof v === "string" && v.trim()) tipeado[campo] = v.trim().slice(0, LARGO_MAX[campo]);
  }

  const { datos: actual, bloqueados, faltantes } = lectura;
  const deAlegra = CAMPOS_FACTURACION.filter(
    (c) => tipeado[c] !== undefined && bloqueados.includes(c) && !mismoValor(c, tipeado[c]!, actual),
  );
  if (deAlegra.length > 0) return { ok: false, motivo: "campo_de_alegra", campos: deAlegra };

  const aceptables = new Set<CampoFacturacion>([
    ...faltantes,
    ...OPCIONALES.filter((c) => !actual[c]),
  ]);
  const complemento: Complemento = {};
  for (const c of aceptables) if (tipeado[c] !== undefined) complemento[c] = tipeado[c];

  const errores: Partial<Record<CampoFacturacion, string>> = {};
  for (const c of faltantes) if (!complemento[c]) errores[c] = MENSAJE_FALTA[c];

  const datos: DatosContacto = { ...actual };

  if (complemento.condicionIva !== undefined) {
    if (esCondicion(complemento.condicionIva)) datos.condicionIva = complemento.condicionIva;
    else errores.condicionIva = MENSAJE_FALTA.condicionIva;
  }
  if (complemento.razonSocial !== undefined) datos.razonSocial = complemento.razonSocial;

  if (complemento.tipoDoc !== undefined) {
    const t = complemento.tipoDoc;
    if (t === "CUIT" || t === "DNI") datos.tipoDoc = t;
    else errores.tipoDoc = MENSAJE_FALTA.tipoDoc;
  }
  if (complemento.nroDoc !== undefined) {
    const tipo = datos.tipoDoc ?? "CUIT";
    const nro = soloDigitos(complemento.nroDoc);
    const valido = tipo === "DNI" ? dniValido(nro) : cuitValido(nro);
    if (!valido) errores.nroDoc = tipo === "DNI" ? "Ingrese un DNI válido." : "Ingrese un CUIT válido.";
    else {
      complemento.nroDoc = nro;
      datos.nroDoc = nro;
    }
  } else if (complemento.tipoDoc !== undefined && datos.nroDoc && !errores.tipoDoc) {
    // Falta sólo el tipo: el número es el de Alegra y no se cambia.
    const valido = datos.tipoDoc === "DNI" ? dniValido(datos.nroDoc) : cuitValido(datos.nroDoc);
    if (!valido) {
      errores.tipoDoc = `El documento de su cuenta no es un ${datos.tipoDoc} válido. Escríbanos para corregirlo.`;
    }
  }

  // Tipo deducido (no está en Alegra) + condición cargada: se vuelve a deducir.
  if (complemento.condicionIva && lectura.tipoDocDeducido && complemento.tipoDoc === undefined) {
    const d = deducirTipoDoc({ condicion: datos.condicionIva, numero: datos.nroDoc });
    if (d.tipo && !d.incompatible) datos.tipoDoc = d.tipo;
  }

  const seTipeoDocOCondicion =
    complemento.condicionIva !== undefined || complemento.tipoDoc !== undefined || complemento.nroDoc !== undefined;
  if (
    seTipeoDocOCondicion &&
    datos.condicionIva &&
    exigeCuit(datos.condicionIva) &&
    !errores.condicionIva &&
    !errores.tipoDoc &&
    !errores.nroDoc
  ) {
    const esCuit = datos.tipoDoc === "CUIT" && cuitValido(datos.nroDoc ?? "");
    if (!esCuit) {
      const label = CONDICION_IVA_LABEL[datos.condicionIva];
      if (complemento.tipoDoc !== undefined || complemento.nroDoc !== undefined) {
        errores.tipoDoc = `La condición ${label} exige CUIT.`;
      } else {
        errores.condicionIva = `La condición ${label} exige CUIT y el documento de su cuenta no lo es. Si es correcta, escríbanos.`;
      }
    }
  }

  if (complemento.domicilioProvincia !== undefined) {
    const canonica = provinciaCanonica(complemento.domicilioProvincia);
    if (!canonica) errores.domicilioProvincia = MENSAJE_FALTA.domicilioProvincia;
    else {
      complemento.domicilioProvincia = canonica;
      datos.domicilioProvincia = canonica;
    }
  }
  for (const c of ["domicilioCalle", "domicilioCiudad", "domicilioCp"] as const) {
    if (complemento[c] !== undefined) datos[c] = complemento[c];
  }

  if (Object.keys(errores).length > 0) return { ok: false, motivo: "invalido", errores };
  return { ok: true, complemento, datos };
}

// ---------------------------------------------------------------------------
// PUT a Alegra
// ---------------------------------------------------------------------------

/**
 * ¿Se escribe "CUIL" en `identificationObject.type`? No: Alegra no tiene ese
 * tipo (ofrece CUIT, CDI, CI Extranjera, Pasaporte, DNI y Otro; confirmado en
 * la cuenta real, 2026-09-24). Una CUIL deducida se usa sólo para validar en el
 * Shop y el tipo queda vacío en Alegra, como estaba.
 */
export const ESCRIBIR_CUIL_EN_ALEGRA = false;

export interface CuerpoPutContacto {
  name: string;
  ivaCondition?: string;
  identificationObject: { type: string; number: string };
  address?: { address?: string; city?: string; province?: string; postalCode?: string };
}

/**
 * Cuerpo del PUT /contacts/{id} (D-7): SIEMPRE `name`, `ivaCondition` e
 * `identificationObject` (obligatorios en AR; los del espejo tal cual, o lo
 * cargado/deducido si estaban vacíos), y `address` SÓLO si se completa algo del
 * domicilio — como objeto completo (Alegra podría reemplazarlo entero), sin
 * claves vacías. Nada más: ni email, ni teléfonos, ni observaciones.
 */
export function armarPutSoloVacios(
  base: ContactoFacturacion,
  datos: DatosContacto,
  complemento: Complemento,
  { escribirCuil = ESCRIBIR_CUIL_EN_ALEGRA }: { escribirCuil?: boolean } = {},
): CuerpoPutContacto {
  const tipoParaAlegra = (t: TipoDoc | undefined) =>
    !t || (t === "CUIL" && !escribirCuil) ? "" : t;

  const cuerpo: CuerpoPutContacto = {
    name: base.name ?? datos.razonSocial ?? "",
    identificationObject: {
      type: base.identificationType ?? tipoParaAlegra(datos.tipoDoc),
      number: base.identificationNumber ?? base.identification ?? datos.nroDoc ?? "",
    },
  };
  const iva = base.ivaCondition ?? (datos.condicionIva ? condicionAAlegra(datos.condicionIva) : undefined);
  if (iva) cuerpo.ivaCondition = iva;

  const tocaDomicilio = (["domicilioCalle", "domicilioCiudad", "domicilioProvincia", "domicilioCp"] as const).some(
    (c) => complemento[c] !== undefined,
  );
  if (tocaDomicilio) {
    const address = {
      address: base.addressStreet ?? complemento.domicilioCalle,
      city: base.addressCity ?? complemento.domicilioCiudad,
      province: base.addressProvince ?? complemento.domicilioProvincia,
      postalCode: base.addressPostalCode ?? complemento.domicilioCp,
    };
    cuerpo.address = Object.fromEntries(
      Object.entries(address).filter(([, v]) => typeof v === "string" && v !== ""),
    );
  }
  return cuerpo;
}

// ---------------------------------------------------------------------------
// Pedido y checkout
// ---------------------------------------------------------------------------

export interface FacturacionCongelada {
  tipoDoc: string;
  nroDoc: string;
  razonSocial: string;
  condicionIva: string;
  domicilio?: string;
}

/**
 * Lo que se congela en el pedido: la condición real (la del Shop o, si no
 * mapea, el valor crudo de Alegra) y el documento sólo con dígitos, como el
 * perfil. null si falta algo esencial.
 */
export function congelarFacturacion(datos: {
  tipoDoc?: string;
  nroDoc?: string;
  razonSocial?: string;
  condicionIva?: string;
  condicionIvaAlegra?: string | null;
  domicilioCalle?: string;
  domicilioCiudad?: string;
  domicilioProvincia?: string;
  domicilioCp?: string;
}): FacturacionCongelada | null {
  const condicion = datos.condicionIva ?? datos.condicionIvaAlegra ?? null;
  if (!datos.tipoDoc || !datos.nroDoc || !datos.razonSocial || !condicion) return null;
  return {
    tipoDoc: datos.tipoDoc,
    // Como en el perfil: sin guiones ni puntos (el CNPJ conserva sus letras).
    nroDoc: normalizarDoc(datos.tipoDoc as TipoDoc, datos.nroDoc) || datos.nroDoc,
    razonSocial: datos.razonSocial,
    condicionIva: condicion,
    domicilio: domicilioEnLinea(datos) || undefined,
  };
}

export type FuenteFacturacion = "espejo" | "vivo" | "mixto" | "perfil" | "ninguna" | "no_disponible";

/**
 * ¿Puede confirmar el checkout y qué aviso ve? Con un complemento guardado
 * "en el pedido" (respaldo de la cookie del CRM) se puede confirmar: el
 * servidor lo revalida.
 */
export function estadoFacturacionCheckout({
  completo,
  fuente,
  complemento,
}: {
  completo: boolean;
  fuente: FuenteFacturacion;
  complemento: Complemento | null;
}): { puedeConfirmar: boolean; aviso: "faltan_datos" | "no_disponible" | null } {
  if (completo || complemento) return { puedeConfirmar: true, aviso: null };
  if (fuente === "no_disponible") return { puedeConfirmar: false, aviso: "no_disponible" };
  return { puedeConfirmar: false, aviso: "faltan_datos" };
}
