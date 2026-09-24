/**
 * Lectura ÚNICA de los datos de facturación del comprador (change
 * `contacto-fuente-unica`). SOLO servidor.
 *
 * Checkout, `POST /api/pedidos`, `PUT /api/mi-cuenta/facturacion` y Mis datos
 * deciden con esto si se puede comprar y qué se factura; ninguno lee el perfil
 * o el espejo por su cuenta para eso.
 *
 * - Vinculado (Clerk con vínculo, Clerk + cookie del CRM o sólo cookie): el
 *   ESPEJO de contactos del CRM (fila activa de la vista). Sin fila, UN GET en
 *   vivo con el mismo mapeo. Con Clerk, el perfil complementa sólo si es el
 *   mismo documento (D2).
 * - No vinculado: el perfil de `shop.billing_profiles`, como siempre.
 */
import type { Identidad } from "./auth";
import { getContacto } from "./alegra";
import {
  REQUERIDOS,
  contactoDeAlegra,
  leerContacto,
  mezclarConPerfil,
  type CampoFacturacion,
  type ContactoFacturacion,
  type FuenteFacturacion,
  type LecturaContacto,
  type MotivoRevision,
} from "./contacto-alegra";
import { facturacionEspejo } from "./contactos-espejo";
import { soloDigitos, validarFacturacion, type CondicionIva, type Pais, type TipoDoc } from "./facturacion";
import { getPerfilFacturacion, perfilCompleto, type PerfilFacturacion } from "./facturacion-db";
import { tienePerfilFacturacion } from "./mis-datos";

/** Datos para mostrar y congelar. `condicionIva` puede ser un valor crudo de Alegra. */
export interface DatosLeidos {
  pais: string;
  tipoDoc?: string;
  nroDoc?: string;
  razonSocial?: string;
  condicionIva?: string;
  condicionIvaAlegra?: string | null;
  domicilioCalle?: string;
  domicilioCiudad?: string;
  domicilioProvincia?: string;
  domicilioCp?: string;
}

export interface DatosDelContacto {
  fuente: FuenteFacturacion;
  vinculado: boolean;
  alegraId: string | null;
  datos: DatosLeidos;
  bloqueados: CampoFacturacion[];
  faltantes: CampoFacturacion[];
  /** faltantes vacío y fuente disponible. */
  completo: boolean;
  motivoRevision: MotivoRevision | null;
  /** El tipo de documento no está en Alegra: lo dedujo el Shop (el modal lo necesita para validar). */
  tipoDocDeducido: boolean;
  /** Fila del perfil (Clerk). Da el teléfono y `coincideConAlegra`. */
  perfil: PerfilFacturacion | null;
  /**
   * SOLO SERVIDOR (no pasarlo a un componente de cliente): contacto base para
   * el PUT "sólo vacíos" y la lectura con la que se valida el complemento.
   */
  interno: { base: ContactoFacturacion; lectura: LecturaContacto } | null;
}

type IdentidadFacturacion = Pick<Identidad, "clerkUserId" | "cliente">;

/** Motivo técnico de un error de Alegra, sin cuerpo ni datos. */
function estadoAlegra(err: unknown): string {
  return err instanceof Error ? (/Alegra (\d{3})/.exec(err.message)?.[1] ?? "sin respuesta") : "sin respuesta";
}

function datosDePerfil(perfil: PerfilFacturacion | null): DatosLeidos {
  if (!perfil) return { pais: "AR" };
  const d: DatosLeidos = { pais: perfil.pais ?? "AR" };
  if (perfil.tipoDoc) d.tipoDoc = perfil.tipoDoc;
  if (perfil.nroDoc) d.nroDoc = perfil.nroDoc;
  if (perfil.razonSocial) d.razonSocial = perfil.razonSocial;
  if (perfil.condicionIva) d.condicionIva = perfil.condicionIva;
  if (perfil.domicilioCalle) d.domicilioCalle = perfil.domicilioCalle;
  if (perfil.domicilioCiudad) d.domicilioCiudad = perfil.domicilioCiudad;
  if (perfil.domicilioProvincia) d.domicilioProvincia = perfil.domicilioProvincia;
  if (perfil.domicilioCp) d.domicilioCp = perfil.domicilioCp;
  return d;
}

/** Requeridos que le faltan a un perfil (regla de siempre: `validarFacturacion`). */
function faltantesDePerfil(perfil: PerfilFacturacion | null): CampoFacturacion[] {
  if (perfilCompleto(perfil)) return [];
  if (!perfil) return [...REQUERIDOS];
  const errores = validarFacturacion({
    pais: perfil.pais as Pais,
    tipoDoc: (perfil.tipoDoc ?? undefined) as TipoDoc | undefined,
    nroDoc: perfil.nroDoc ?? undefined,
    razonSocial: perfil.razonSocial ?? undefined,
    condicionIva: (perfil.condicionIva ?? undefined) as CondicionIva | undefined,
    domicilioCalle: perfil.domicilioCalle ?? undefined,
    domicilioCiudad: perfil.domicilioCiudad ?? undefined,
  });
  const campos = REQUERIDOS.filter((c) => c in errores);
  return campos.length > 0 ? campos : [...REQUERIDOS];
}

function contactoVacio(alegraId: string): ContactoFacturacion {
  return {
    alegraId,
    name: null,
    identification: null,
    identificationNorm: null,
    identificationType: null,
    identificationNumber: null,
    ivaCondition: null,
    addressStreet: null,
    addressCity: null,
    addressProvince: null,
    addressPostalCode: null,
  };
}

/**
 * El contacto para facturar: espejo; sin fila activa (o si la vista no
 * responde), 1 GET en vivo. `null` = no se pudo saber qué tiene Alegra.
 * Un 404 de Alegra = contacto sin datos (todo faltante).
 */
async function contactoParaFacturar(
  alegraId: string,
): Promise<{ base: ContactoFacturacion; fuente: "espejo" | "vivo" } | null> {
  try {
    const espejo = await facturacionEspejo(alegraId);
    if (espejo) return { base: espejo, fuente: "espejo" };
  } catch (err) {
    const codigo = (err as { code?: unknown })?.code;
    console.error(`[facturacion] el espejo de contactos no respondió (${codigo ?? "sin código"})`);
  }
  try {
    const c = await getContacto(alegraId);
    if (!c) return { base: contactoVacio(alegraId), fuente: "vivo" };
    return { base: { ...contactoDeAlegra(c), alegraId }, fuente: "vivo" };
  } catch (err) {
    const estado = estadoAlegra(err);
    if (estado === "404") return { base: contactoVacio(alegraId), fuente: "vivo" };
    console.error(`[facturacion] respaldo en vivo del contacto ${alegraId} falló (${estado})`);
    return null;
  }
}

/** La lectura única. */
export async function datosDelContacto(identidad: IdentidadFacturacion): Promise<DatosDelContacto> {
  const { clerkUserId, cliente } = identidad;
  const perfil = clerkUserId ? await getPerfilFacturacion(clerkUserId) : null;

  // --- No vinculado: el perfil, como siempre ---
  if (!cliente) {
    const faltantes = faltantesDePerfil(perfil);
    return {
      fuente: tienePerfilFacturacion(perfil) ? "perfil" : "ninguna",
      vinculado: false,
      alegraId: null,
      datos: datosDePerfil(perfil),
      bloqueados: [],
      faltantes,
      completo: faltantes.length === 0,
      motivoRevision: null,
      tipoDocDeducido: false,
      perfil,
      interno: null,
    };
  }

  // --- Vinculado: el espejo (o Alegra en vivo) ---
  const alegraId = cliente.codigocliente;
  const contacto = await contactoParaFacturar(alegraId);

  if (!contacto) {
    // Sin saber qué tiene Alegra no se puede garantizar D1: no se ofrece
    // completar. Un perfil completo con el documento de la vinculación sirve.
    const docVinculo = soloDigitos(cliente.cuit ?? "");
    const sirvePerfil =
      perfilCompleto(perfil) && Boolean(docVinculo) && soloDigitos(perfil?.nroDoc ?? "") === docVinculo;
    return {
      fuente: sirvePerfil ? "perfil" : "no_disponible",
      vinculado: true,
      alegraId,
      datos: sirvePerfil ? datosDePerfil(perfil) : { pais: "AR" },
      bloqueados: [],
      faltantes: sirvePerfil ? [] : [...REQUERIDOS],
      completo: sirvePerfil,
      motivoRevision: null,
      tipoDocDeducido: false,
      perfil,
      interno: null,
    };
  }

  let lectura = leerContacto(contacto.base);
  // Contacto sin documento en Alegra (404 o vacío): el de la vinculación
  // permite la mezcla con un perfil del mismo documento.
  if (!lectura.documentoNorm && cliente.cuit) {
    lectura = { ...lectura, documentoNorm: soloDigitos(cliente.cuit) || null };
  }
  const { lectura: mezclada, aporto } = mezclarConPerfil(lectura, perfil);

  return {
    fuente: aporto.length > 0 ? "mixto" : contacto.fuente,
    vinculado: true,
    alegraId,
    datos: mezclada.datos,
    bloqueados: mezclada.bloqueados,
    faltantes: mezclada.faltantes,
    completo: mezclada.completo,
    motivoRevision: mezclada.motivoRevision,
    tipoDocDeducido: mezclada.tipoDocDeducido,
    perfil,
    interno: { base: contacto.base, lectura: mezclada },
  };
}

/** Lo que el checkout y Mis datos pueden mandar al navegador (sin `interno`). */
export type DatosDelContactoPublico = Omit<DatosDelContacto, "interno" | "perfil">;

export function paraElCliente(dc: DatosDelContacto): DatosDelContactoPublico {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- se descartan a propósito
  const { interno, perfil, ...resto } = dc;
  return resto;
}
