/**
 * Facturación del invitado, en línea (change `compra-como-invitado`, S2a). Lógica PURA.
 *
 * El invitado no tiene perfil ni contacto de Alegra: carga sus datos fiscales en el propio pedido,
 * en uno de dos modos:
 *  - `consumidor_final`: nombre + DNI.
 *  - `factura_a`: CUIT + razón social + condición frente al IVA (monotributo, responsable inscripto
 *    o exento).
 *
 * Se valida con la MISMA regla del resto del Shop (`validarFacturacion`: dígito verificador del CUIT,
 * DNI, provincia canónica) y se congela en `orders.facturacion_*` con `congelarFacturacion`. NO se
 * escribe `billing_profiles` ni nada en Alegra. El domicilio fiscal es el de la entrega (a
 * domicilio); en un retiro en el local el comprador lo carga en el mismo bloque. País: Argentina.
 *
 * Los mensajes son los de `validarFacturacion` (ya en usted) más los de este módulo.
 */
import type { DatosDelContacto, DatosLeidos } from "./datos-del-contacto";
import { normalizarDoc, validarFacturacion, type CondicionIva, type TipoDoc } from "./facturacion";
import { provinciaCanonica } from "./provincias";

export type ModoFacturacionInvitado = "consumidor_final" | "factura_a";

const CONDICIONES_FACTURA_A: readonly CondicionIva[] = ["monotributo", "responsable_inscripto", "exento"];

/** Código postal argentino: viejo (4 dígitos) o CPA (una letra, 4 dígitos y hasta 3 letras). */
const CP_ARGENTINO = /^(?:\d{4}|[A-Za-z]\d{4}[A-Za-z]{0,3})$/;

export interface EntregaParaFacturar {
  tipo: "envio" | "retiro";
  /** Dirección y ciudad de la entrega (envío a domicilio). */
  calle?: string;
  ciudad?: string;
  /** Ya canónica (la ruta la valida para el envío). */
  provincia?: string | null;
}

export type ResultadoFacturacionInvitado =
  | { ok: true; datos: DatosLeidos; modo: ModoFacturacionInvitado; tipoDoc: TipoDoc; nroDoc: string }
  | { ok: false; error: string; motivo: "facturacion_invalida"; campos: string[] };

const texto = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

const falla = (error: string, campos: string[]): ResultadoFacturacionInvitado => ({
  ok: false,
  error,
  motivo: "facturacion_invalida",
  campos,
});

/** Orden en que se muestra el primer error. */
const ORDEN_CAMPOS = [
  "modo",
  "razonSocial",
  "tipoDoc",
  "nroDoc",
  "condicionIva",
  "domicilioCalle",
  "domicilioCiudad",
  "domicilioProvincia",
  "domicilioCp",
];

export function resolverFacturacionInvitado(
  raw: unknown,
  entrega: EntregaParaFacturar,
  /** El nombre de contacto: sirve de nombre fiscal para el consumidor final que no lo repite. */
  nombreContacto: string,
): ResultadoFacturacionInvitado {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return falla("Indique sus datos de facturación.", ["modo"]);
  }
  const f = raw as Record<string, unknown>;
  const modo = f.modo;
  if (modo !== "consumidor_final" && modo !== "factura_a") {
    return falla("Indique si necesita factura A o es consumidor final.", ["modo"]);
  }

  const esFacturaA = modo === "factura_a";
  const tipoDoc: TipoDoc = esFacturaA ? "CUIT" : "DNI";
  const condicionPedida = texto(f.condicionIva, 40);
  let condicionIva: CondicionIva = "consumidor_final";
  if (esFacturaA) {
    if (!CONDICIONES_FACTURA_A.includes(condicionPedida as CondicionIva)) {
      return falla("Elija su condición frente al IVA.", ["condicionIva"]);
    }
    condicionIva = condicionPedida as CondicionIva;
  }

  const aDomicilio = entrega.tipo === "envio";
  const provinciaTexto = aDomicilio ? (entrega.provincia ?? "") : texto(f.domicilioProvincia, 80);
  const datos: DatosLeidos & { pais: string } = {
    pais: "AR",
    tipoDoc,
    nroDoc: normalizarDoc(tipoDoc, texto(f.nroDoc, 30)),
    razonSocial: texto(f.razonSocial, 120) || (esFacturaA ? "" : texto(nombreContacto, 120)),
    condicionIva,
    domicilioCalle: aDomicilio ? texto(entrega.calle, 200) : texto(f.domicilioCalle, 200),
    domicilioCiudad: aDomicilio ? texto(entrega.ciudad, 80) : texto(f.domicilioCiudad, 80),
    domicilioProvincia: provinciaCanonica(provinciaTexto) ?? provinciaTexto,
    domicilioCp: texto(f.domicilioCp, 10).toUpperCase(),
  };

  const errores = validarFacturacion({
    pais: "AR",
    tipoDoc,
    nroDoc: datos.nroDoc,
    razonSocial: datos.razonSocial,
    condicionIva,
    domicilioCalle: datos.domicilioCalle,
    domicilioCiudad: datos.domicilioCiudad,
    domicilioProvincia: datos.domicilioProvincia,
    domicilioCp: datos.domicilioCp,
  });
  if (!datos.domicilioCp) errores.domicilioCp = "Ingrese el código postal.";
  else if (!CP_ARGENTINO.test(datos.domicilioCp)) errores.domicilioCp = "Ingrese un código postal válido.";

  const campos = Object.keys(errores);
  if (campos.length > 0) {
    campos.sort((a, b) => ORDEN_CAMPOS.indexOf(a) - ORDEN_CAMPOS.indexOf(b));
    return falla(errores[campos[0]], campos);
  }
  return { ok: true, datos, modo, tipoDoc, nroDoc: datos.nroDoc as string };
}

/**
 * El "contacto" de un invitado, con la forma que usa el resto de `POST /api/pedidos` para el
 * comprador con cuenta: sin fuente de Alegra, sin vínculo, sin perfil, sin teléfono de Alegra.
 */
export function datosDelContactoInvitado(datos: DatosLeidos): DatosDelContacto {
  return {
    fuente: "ninguna",
    vinculado: false,
    alegraId: null,
    datos,
    bloqueados: [],
    faltantes: [],
    completo: true,
    motivoRevision: null,
    tipoDocDeducido: false,
    telefonos: null,
    telefonoAlegra: null,
    perfil: null,
    interno: null,
  };
}
