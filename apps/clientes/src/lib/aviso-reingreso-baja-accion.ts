"use server";

/**
 * Server action de la página de baja (`/baja-aviso/[token]`): el botón «Confirmar baja». La baja es un
 * POST a propósito: abrir el enlace (GET) no modifica nada, así los escáneres de los clientes de correo
 * que precargan los enlaces no dan de baja a nadie. Nunca lanza; vuelve a la página con el resultado.
 * Funciona aunque el flag `aviso-reingreso` esté apagado (los avisos ya creados deben poder darse de baja).
 */
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { shopTenantId } from "@/lib/tenant";
import { bajaPorToken } from "./aviso-reingreso-repo";

export async function confirmarBajaAviso(fd: FormData): Promise<void> {
  const crudo = fd.get("token");
  const token = typeof crudo === "string" ? crudo.trim() : "";
  let estado: "hecho" | "invalido" | "error";
  try {
    estado = (await bajaPorToken(getDb(), shopTenantId(), token)) ? "hecho" : "invalido";
  } catch (err) {
    console.error("[aviso-reingreso] no se pudo procesar la baja:", err instanceof Error ? err.message : err);
    estado = "error";
  }
  redirect(`/baja-aviso/${encodeURIComponent(token)}?estado=${estado}`);
}
