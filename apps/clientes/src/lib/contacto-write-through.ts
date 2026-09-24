/**
 * Escritura del Shop sobre un contacto de Alegra: completar vacíos (D1) y dejar
 * el espejo del CRM al día al instante. SOLO servidor.
 *
 * Camino feliz: PUT /contacts/{id} "sólo vacíos" (cuerpo de
 * `armarPutSoloVacios`) → la respuesta completa de Alegra va a
 * `public.shop_contacto_write_through` (migración 0034 del CRM), que vuelve a
 * exigir D1 en la base y actualiza la fila del espejo. La próxima lectura
 * (`datosDelContacto`) ya ve los datos, sin esperar al webhook ni a la sync.
 *
 * Si Alegra falla (tope de /contacts como 400 `{"code":429}`, validación, red o
 * timeout de 8 s) la compra NO se traba (D-8):
 *  - con Clerk, lo tipeado va al perfil con el documento del espejo (D2 lo
 *    mezcla la próxima vez) y un pedido "mixto" reintenta subirlo en `after()`;
 *  - con sólo la cookie del CRM no hay dónde guardarlo: vuelve al checkout, que
 *    lo manda con el pedido (queda para revisión).
 *
 * Los logs llevan el id del contacto y el status, nunca cuerpos ni datos.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  actualizarContacto,
  actualizarContactoTalCual,
  actualizarObservacionesContacto,
  getContacto,
  type AlegraContact,
} from "./alegra";
import {
  armarPutSoloVacios,
  contactoDeAlegra,
  leerContacto,
  mezclarConPerfil,
  telefonoParaAlegra,
  telefonoPreferido,
  type Complemento,
  type ContactoFacturacion,
  type DatosContacto,
} from "./contacto-alegra";
import { CUENTA_ALEGRA_PRINCIPAL } from "./contactos-espejo";
import { getPerfilFacturacion, upsertRespaldoVinculado } from "./facturacion-db";
import { observacionesConEmail } from "./observaciones-contacto";
import { provinciaCanonica } from "./provincias";
import { shopTenantId } from "./tenant";

function estadoAlegra(err: unknown): string {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) return "timeout";
  return err instanceof Error ? (/^Alegra (\d{3})/.exec(err.message)?.[1] ?? "sin respuesta") : "sin respuesta";
}

export type ResultadoEspejo = "ok" | "sin_fila" | "rechazado" | "error";

/**
 * Pasa el contacto que devolvió Alegra a la función del CRM. 'sin_fila' o
 * 'rechazado' sólo se registran: Alegra ya tiene el dato y el webhook o la sync
 * lo traen. Nunca lanza.
 *
 * El jsonb viaja como TEXTO y se castea en SQL: postgres.js vuelve a serializar
 * un string pasado a un parámetro jsonb (llegaría un string JSON, no un objeto,
 * y la función respondería 'rechazado').
 */
export async function escribirEspejo(alegraId: string, contacto: AlegraContact): Promise<ResultadoEspejo> {
  try {
    const filas = (await getDb().execute(
      sql`select public.shop_contacto_write_through(${shopTenantId()}, ${CUENTA_ALEGRA_PRINCIPAL}, ${alegraId}, ${JSON.stringify(contacto)}::text::jsonb) as resultado`,
    )) as unknown as { resultado: string }[];
    const resultado = (filas[0]?.resultado ?? "error") as ResultadoEspejo;
    if (resultado !== "ok") console.warn(`[contacto] write-through del contacto ${alegraId}: ${resultado}`);
    return resultado;
  } catch (err) {
    const codigo = (err as { code?: unknown })?.code;
    console.error(`[contacto] write-through del contacto ${alegraId} falló (${codigo ?? "sin código"})`);
    return "error";
  }
}

export type ResultadoCompletar =
  | { estado: "alegra" }
  | { estado: "perfil" }
  | { estado: "en_pedido"; complemento: Complemento };

/**
 * Completa en Alegra los vacíos que cargó el comprador vinculado (ya validados
 * con `validarComplemento`). `datos` = los del espejo con el complemento
 * aplicado. Lanza sólo si falla el respaldo en el perfil.
 */
export async function completarEnAlegra({
  alegraId,
  base,
  datos,
  complemento,
  clerkUserId,
}: {
  alegraId: string;
  base: ContactoFacturacion;
  datos: DatosContacto;
  complemento: Complemento;
  clerkUserId: string | null;
}): Promise<ResultadoCompletar> {
  try {
    const cuerpo = armarPutSoloVacios(base, datos, complemento);
    const respuesta = await actualizarContacto(alegraId, { ...cuerpo });
    await escribirEspejo(alegraId, respuesta);
    return { estado: "alegra" };
  } catch (err) {
    console.error(`[contacto] no se pudo completar el contacto ${alegraId} en Alegra (${estadoAlegra(err)})`);
  }

  if (!clerkUserId) return { estado: "en_pedido", complemento };

  await upsertRespaldoVinculado(clerkUserId, {
    tipoDoc: datos.tipoDoc ?? "CUIT",
    nroDoc: datos.nroDoc ?? "",
    razonSocial: datos.razonSocial ?? null,
    complemento,
  });
  return { estado: "perfil" };
}

/**
 * Subida en segundo plano (D-11), para `after()`: al confirmar una vinculación,
 * tras un pedido "mixto" (algo quedó en el perfil porque el PUT falló) y tras
 * un pedido cuyo teléfono no está en Alegra.
 *
 * 1 GET en vivo (el documento fresco, no el del espejo) y, como mucho, UN PUT
 * que junta el email alternativo en las observaciones, los vacíos de Alegra
 * que el perfil tiene con el mismo documento (D2) y el `telefono` tipeado en
 * el checkout — éste SÓLO si el contacto fresco no tiene ningún teléfono
 * (celular, principal ni secundario): "sólo completar vacíos" también para el
 * teléfono, que la función del espejo no controla. Va a `phonePrimary`.
 * Nada que aportar ⇒ sin PUT. Si algo falla, se registra y listo: nunca lanza.
 */
export async function sincronizarContactoConPerfil(
  alegraId: string,
  {
    clerkUserId,
    emailAlternativo,
    telefono,
    fecha = new Date(),
  }: { clerkUserId: string | null; emailAlternativo?: string; telefono?: string | null; fecha?: Date },
): Promise<void> {
  try {
    const crudo = await getContacto(alegraId);
    if (!crudo) return;

    // Contra el contacto FRESCO: el espejo puede estar atrasado unos minutos.
    const telefonoNuevo =
      telefonoParaAlegra(telefono) && !telefonoPreferido(contactoDeAlegra(crudo)) ? telefonoParaAlegra(telefono) : null;

    const observaciones = emailAlternativo
      ? observacionesConEmail(crudo.observations, crudo.email, emailAlternativo, fecha)
      : null;

    const perfil = clerkUserId ? await getPerfilFacturacion(clerkUserId) : null;
    const base = { ...contactoDeAlegra(crudo), alegraId };
    const { lectura, aporto } = mezclarConPerfil(leerContacto(base), perfil);

    const complemento: Complemento = {};
    for (const campo of aporto) {
      const valor = lectura.datos[campo as keyof DatosContacto];
      if (typeof valor !== "string" || !valor) continue;
      if (campo === "domicilioProvincia") {
        // A Alegra sólo sube una provincia de la lista oficial.
        const canonica = provinciaCanonica(valor);
        if (canonica) complemento.domicilioProvincia = canonica;
        continue;
      }
      complemento[campo] = valor;
    }
    const hayComplemento = Object.keys(complemento).length > 0;

    if (!observaciones && !hayComplemento && !telefonoNuevo) return;

    const extra = {
      ...(observaciones ? { observations: observaciones } : {}),
      ...(telefonoNuevo ? { phonePrimary: telefonoNuevo } : {}),
    };
    let respuesta: AlegraContact;
    if (!hayComplemento && !telefonoNuevo) {
      // Sólo observaciones: el PUT de siempre, que reenvía nombre, condición y
      // documento tal cual vinieron (nunca un PUT sólo para escribir el tipo).
      respuesta = await actualizarObservacionesContacto({ ...crudo, id: alegraId }, observaciones!);
    } else if (!hayComplemento) {
      // Teléfono (y quizá observaciones): lo mismo, tal cual + lo vacío.
      respuesta = await actualizarContactoTalCual({ ...crudo, id: alegraId }, extra);
    } else {
      const cuerpo = armarPutSoloVacios(base, lectura.datos, complemento);
      respuesta = await actualizarContacto(alegraId, { ...cuerpo, ...extra });
    }
    // Las observaciones solas no tocan columnas del espejo; igual se pasa la
    // respuesta: la función deja `raw` al día y es idempotente.
    if (respuesta && typeof respuesta === "object" && "id" in respuesta) await escribirEspejo(alegraId, respuesta);
  } catch (err) {
    console.error(
      `[contacto] no se pudo sincronizar el contacto ${alegraId} con el perfil ni anotar el email alternativo (Alegra ${estadoAlegra(err)})`,
    );
  }
}
