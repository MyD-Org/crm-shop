"use server";

/**
 * Server action del Botón de arrepentimiento (`/arrepentimiento`, form público
 * sin sesión). Nunca lanza: todo termina en un `EstadoArrepentimiento`.
 *
 * Orden: trampa → tiempo de llenado → campos → rate limit por IP → tope por
 * email en la base → INSERT → código → mails → marcas. La solicitud se guarda
 * ANTES de mandar los mails: el código (Res. 424/2020) se muestra aunque Resend
 * falle, y el resultado de los avisos queda en las columnas `email_*`.
 * La IP solo se usa en memoria para el rate limit; no se guarda.
 */
import { headers } from "next/headers";
import { getDb } from "@/db";
import { datosTenant } from "@/lib/cuenta-corriente/tenant-cc";
import { enviarEmail } from "@/lib/email";
import { getDatosLegales } from "@/lib/home-datos";
import { shopTenantId } from "@/lib/tenant";
import {
  CAMPO_TRAMPA,
  MAX_POR_EMAIL,
  MAX_POR_IP,
  VENTANA_EMAIL_MS,
  VENTANA_IP_MS,
  formatearCodigoArrepentimiento,
  leerCampos,
  llenadoValido,
  validarCampos,
  type CamposArrepentimiento,
  type EstadoArrepentimiento,
} from "./arrepentimiento";
import { armarMailArrepentimientoCliente, armarMailArrepentimientoComercio } from "./arrepentimiento-mail";
import { contarRecientesPorEmail, insertarSolicitud, marcarEnvios } from "./arrepentimiento-repo";
import { permitir } from "./rate-limit";
import { urlLogoMail } from "./vinculacion-mail";

const ERROR_GENERICO = "No se pudo registrar la solicitud. Inténtelo de nuevo en unos minutos.";
const ERROR_DEMASIADAS = "Recibimos demasiadas solicitudes. Inténtelo nuevamente más tarde.";
const ERROR_DB = "No se pudo registrar la solicitud. Inténtelo de nuevo o comuníquese con el comercio.";

function error(mensaje: string, valores: CamposArrepentimiento): EstadoArrepentimiento {
  return { estado: "error", mensaje, errores: {}, valores };
}

/** Primera IP de `x-forwarded-for` (la del cliente en Vercel), o `x-real-ip`. */
async function ipDelPedido(): Promise<string> {
  try {
    const h = await headers();
    const xff = h.get("x-forwarded-for")?.split(",")[0]?.trim();
    return xff || h.get("x-real-ip")?.trim() || "desconocida";
  } catch {
    return "desconocida";
  }
}

type ResultadoMail = { ok: true } | { ok: false; error: string };

/** `enviarEmail` no debería lanzar, pero un mail nunca tumba la solicitud. */
async function intentar(envio: () => ReturnType<typeof enviarEmail>): Promise<ResultadoMail> {
  try {
    const r = await envio();
    return r.ok ? { ok: true } : { ok: false, error: r.error ?? "No se pudo enviar el email" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function enviarSolicitudArrepentimiento(
  _prev: EstadoArrepentimiento,
  fd: FormData,
): Promise<EstadoArrepentimiento> {
  const valores = leerCampos(fd);

  const trampa = fd.get(CAMPO_TRAMPA);
  if (typeof trampa === "string" && trampa.trim() !== "") return error(ERROR_GENERICO, valores);

  const iniciado = fd.get("iniciado");
  if (!llenadoValido(typeof iniciado === "string" ? iniciado : null, Date.now())) {
    return error(ERROR_GENERICO, valores);
  }

  const errores = validarCampos(valores);
  if (Object.keys(errores).length > 0) return { estado: "error", errores, valores };

  if (!permitir(`arrepentimiento:ip:${await ipDelPedido()}`, MAX_POR_IP, VENTANA_IP_MS)) {
    return error(ERROR_DEMASIADAS, valores);
  }

  let db: ReturnType<typeof getDb>;
  let solicitud: { id: string; numero: number };
  try {
    db = getDb();
    const tenantId = shopTenantId();
    const desde = new Date(Date.now() - VENTANA_EMAIL_MS);
    if ((await contarRecientesPorEmail(db, tenantId, valores.email, desde)) >= MAX_POR_EMAIL) {
      return error(ERROR_DEMASIADAS, valores);
    }
    solicitud = await insertarSolicitud(db, {
      tenantId,
      nombre: valores.nombre,
      email: valores.email,
      telefono: valores.telefono,
      pedidoNumero: valores.pedido || null,
      motivo: valores.motivo || null,
    });
  } catch (err) {
    console.error("[arrepentimiento] no se pudo guardar la solicitud:", err);
    return error(ERROR_DB, valores);
  }

  const codigo = formatearCodigoArrepentimiento(solicitud.numero);
  const fecha = new Date();

  const legal = await getDatosLegales();
  let tenant: Awaited<ReturnType<typeof datosTenant>> = null;
  try {
    tenant = await datosTenant();
  } catch (err) {
    console.error("[arrepentimiento] no se pudieron leer los datos del tenant:", err);
  }
  const destinoComercio = legal.email || tenant?.mailComprobantes || null;
  if (!destinoComercio) {
    console.warn(`[arrepentimiento] ${codigo}: sin destinatario del comercio (correo legal ni de comprobantes)`);
  }

  const mailCliente = armarMailArrepentimientoCliente({
    codigo,
    nombre: valores.nombre,
    pedido: valores.pedido || undefined,
    motivo: valores.motivo || undefined,
    comercio: tenant?.nombre || legal.razonSocial,
    logoUrl: urlLogoMail(),
  });
  const mailComercio = armarMailArrepentimientoComercio({
    codigo,
    nombre: valores.nombre,
    email: valores.email,
    telefono: valores.telefono,
    pedido: valores.pedido || undefined,
    motivo: valores.motivo || undefined,
    fecha,
  });
  const tags = [{ name: "tipo", value: "arrepentimiento" }];

  const [rCliente, rComercio] = await Promise.all([
    intentar(() =>
      enviarEmail({
        to: valores.email,
        ...mailCliente,
        // El pie invita a responder: que la respuesta llegue al comercio.
        ...(destinoComercio ? { replyTo: destinoComercio } : {}),
        tags,
        idempotencyKey: `${codigo}-cliente`,
      }),
    ),
    destinoComercio
      ? intentar(() =>
          enviarEmail({
            to: destinoComercio,
            ...mailComercio,
            replyTo: valores.email,
            tags,
            idempotencyKey: `${codigo}-comercio`,
          }),
        )
      : Promise.resolve<ResultadoMail>({ ok: false, error: "sin destinatario del comercio" }),
  ]);

  const problemas = [
    rCliente.ok ? null : `cliente: ${rCliente.error}`,
    rComercio.ok ? null : `comercio: ${rComercio.error}`,
  ].filter(Boolean);

  try {
    const enviado = new Date();
    await marcarEnvios(db, solicitud.id, {
      clienteEn: rCliente.ok ? enviado : null,
      comercioEn: rComercio.ok ? enviado : null,
      error: problemas.length ? problemas.join("; ") : null,
    });
  } catch (err) {
    console.error(`[arrepentimiento] ${codigo}: no se pudo registrar el resultado de los mails:`, err);
  }

  return { estado: "ok", codigo, email: valores.email, mailCliente: rCliente.ok };
}
