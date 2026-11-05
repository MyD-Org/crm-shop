"use server";

/**
 * Server action del aviso de reingreso (form de la ficha de un producto agotado). Nunca lanza: todo
 * termina en un `EstadoAviso`.
 *
 * Con sesión de Clerk el email sale de la cuenta (el del form se ignora). Orden: flag → trampa → tiempo de llenado → validar campos → rate limit por IP → tope de pendientes
 * por email → verificar en el servidor que el producto existe, se vende, es inventariable y no tiene
 * disponible → INSERT idempotente. Un aviso duplicado responde igual que uno nuevo (no revela si el
 * email ya estaba). NO manda mail de confirmación (evita usar el form para spamear a terceros). La IP
 * solo se usa en memoria para el rate limit; no se guarda.
 */
import { headers } from "next/headers";
import { getDb } from "@/db";
import { shopTenantId } from "@/lib/tenant";
import { avisoReingresoActivo } from "./aviso-reingreso-flag";
import { elegibleParaAviso } from "./aviso-reingreso-elegibilidad";
import { contarPendientesPorEmail, insertarAviso } from "./aviso-reingreso-repo";
import {
  CAMPO_TRAMPA,
  ERRORES,
  LARGOS,
  MAX_PENDIENTES_POR_EMAIL,
  MAX_POR_IP,
  VENTANA_IP_MS,
} from "./aviso-reingreso-textos";
import { leerCamposAviso, llenadoValido, validarCamposAviso, type EstadoAviso } from "./aviso-reingreso-validacion";
import { permitirAsync } from "./rate-limit";
import { sucursalesCacheadas } from "./sucursales-datos";
import { modalidadesActivas } from "./venta-sin-stock-repo";

const falla = (mensaje: string): EstadoAviso => ({ estado: "error", mensaje, errores: {} });

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

/**
 * Cuenta de Clerk si hay sesión: su id (se guarda como dato) y su email principal. Con sesión el aviso
 * va a ese email y se ignora el del form (la ficha ni lo pide). Sin sesión, o si Clerk falla, null.
 */
async function cuentaActual(): Promise<{ userId: string; email: string | null } | null> {
  try {
    const { auth, currentUser } = await import("@clerk/nextjs/server");
    const { userId } = await auth();
    if (!userId) return null;
    const user = await currentUser();
    const email = user?.primaryEmailAddress?.emailAddress?.trim().toLowerCase() || null;
    return { userId, email };
  } catch {
    return null;
  }
}

export async function solicitarAvisoReingreso(_prev: EstadoAviso, fd: FormData): Promise<EstadoAviso> {
  try {
    if (!(await avisoReingresoActivo())) return falla(ERRORES.noDisponible);

    // Honeypot: éxito aparente sin guardar (el bot no aprende que lo detectamos).
    const trampa = fd.get(CAMPO_TRAMPA);
    if (typeof trampa === "string" && trampa.trim() !== "") return { estado: "ok", encargar: false };

    const iniciado = fd.get("iniciado");
    if (!llenadoValido(typeof iniciado === "string" ? iniciado : null, Date.now())) return falla(ERRORES.generico);

    const alegraId = typeof fd.get("alegraId") === "string" ? (fd.get("alegraId") as string).trim() : "";
    if (!alegraId || alegraId.length > LARGOS.alegraId) return falla(ERRORES.noDisponible);

    const cuenta = await cuentaActual();
    const { campos, whatsappCrudo } = leerCamposAviso(fd);
    if (cuenta?.email) campos.email = cuenta.email;
    const errores = validarCamposAviso(campos, whatsappCrudo);
    if (Object.keys(errores).length > 0) return { estado: "error", errores };

    if (!(await permitirAsync(`aviso-reingreso:ip:${await ipDelPedido()}`, MAX_POR_IP, VENTANA_IP_MS))) {
      return falla(ERRORES.demasiados);
    }

    const db = getDb();
    const tenantId = shopTenantId();
    if ((await contarPendientesPorEmail(db, tenantId, campos.email)) >= MAX_PENDIENTES_POR_EMAIL) {
      return falla(ERRORES.topeEmail);
    }

    const [datos, modalidades] = await Promise.all([sucursalesCacheadas(), modalidadesActivas()]);
    const elegible = await elegibleParaAviso(alegraId, { sucursales: datos.sucursales, modalidades }, db);
    if (!elegible.ok) return falla(ERRORES.noDisponible);

    await insertarAviso(db, {
      tenantId,
      alegraId,
      email: campos.email,
      whatsapp: campos.whatsapp,
      cantidad: campos.cantidad,
      quiereEncargar: campos.quiereEncargar,
      consentimientoContacto: campos.consentimientoContacto,
      clerkUserId: cuenta?.userId ?? null,
    });
    return { estado: "ok", encargar: campos.quiereEncargar };
  } catch (err) {
    // Sin datos personales en el log: solo el mensaje del error.
    console.error("[aviso-reingreso] no se pudo registrar el aviso:", err instanceof Error ? err.message : err);
    return falla(ERRORES.generico);
  }
}
