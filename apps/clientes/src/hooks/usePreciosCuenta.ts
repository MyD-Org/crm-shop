"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { PrecioCuenta } from "@/lib/precio-cuenta";
import {
  estadoDe,
  sesionPorCookie,
  type EstadoPrecioCuenta,
  type ValorCuenta,
} from "@/lib/precios-cuenta-estado";

/**
 * Precios de la LISTA PRIVADA de la cuenta, superpuestos en el navegador sobre el catálogo cacheado
 * (que trae siempre el precio público). Todas las tarjetas de la página comparten un store: los ids
 * se juntan en un solo pedido por tanda y cada id se pregunta una vez.
 *
 * - Visitante con sesión: mientras el overlay no llega, el estado es "pendiente" (los componentes
 *   dibujan un marcador, no el precio público) para que no haya parpadeo.
 * - Anónimo: nunca marcador.
 * - El servidor dice `conLista: false` o el pedido falla: rige el público (sin marcador eterno).
 *
 * Qué lista y qué precios lo decide SIEMPRE el servidor desde la sesión; acá sólo se pregunta por ids.
 */

const cache = new Map<string, ValorCuenta>();
const pendientes = new Set<string>();
const oyentes = new Set<() => void>();
let sinLista = false;
let programado = false;
/** La pista de sesión con la que se llenó el store: si cambia (login/logout sin recarga), se descarta. */
let sesionDelStore: boolean | null = null;

interface Instantanea {
  cache: ReadonlyMap<string, ValorCuenta>;
  sinLista: boolean;
}
const VACIA: Instantanea = { cache: new Map(), sinLista: false };
/** Copia inmutable para React: cambia de identidad en cada tanda. */
let instantanea: Instantanea = VACIA;

function avisar() {
  instantanea = { cache: new Map(cache), sinLista };
  for (const o of oyentes) o();
}

function reiniciar() {
  cache.clear();
  pendientes.clear();
  sinLista = false;
  avisar();
}

async function pedir() {
  programado = false;
  const ids = [...pendientes].slice(0, 60);
  for (const id of ids) pendientes.delete(id);
  if (ids.length === 0 || sinLista) return;
  try {
    const res = await fetch(`/api/precios-cuenta?ids=${ids.join(",")}`, { cache: "no-store" });
    if (!res.ok) {
      // Sin respuesta útil rige el público: no rompe nada ni deja el marcador puesto.
      for (const id of ids) cache.set(id, "publico");
      avisar();
      return;
    }
    const data = (await res.json()) as { conLista: boolean; precios: Record<string, PrecioCuenta | null> };
    if (!data.conLista) {
      sinLista = true;
      avisar();
      return;
    }
    // Un id ausente en la respuesta no tiene precio privado conocido: queda en Consulte (null).
    for (const id of ids) cache.set(id, data.precios[id] ?? null);
    avisar();
  } catch {
    for (const id of ids) cache.set(id, "publico");
    avisar();
  } finally {
    if (pendientes.size > 0) programar();
  }
}

function programar() {
  if (programado) return;
  programado = true;
  setTimeout(pedir, 0);
}

function suscribir(o: () => void) {
  oyentes.add(o);
  return () => oyentes.delete(o);
}

const leerInstantanea = () => instantanea;
const leerVacia = () => VACIA;
const sinSuscripcion = () => () => {};
const leerSesion = () => sesionPorCookie(document.cookie);
const sesionEnServidor = () => false;

/**
 * Estado del precio de la cuenta de cada id. Un id ausente del mapa = rige el precio público.
 */
export function usePreciosCuenta(ids: readonly string[]): ReadonlyMap<string, EstadoPrecioCuenta> {
  const { cache: valores, sinLista: noTieneLista } = useSyncExternalStore(suscribir, leerInstantanea, leerVacia);
  const sesion = useSyncExternalStore(sinSuscripcion, leerSesion, sesionEnServidor);
  const clave = ids.join(",");

  useEffect(() => {
    if (sesionDelStore !== null && sesionDelStore !== sesion) reiniciar();
    sesionDelStore = sesion;
    if (sinLista) return;
    let nuevos = false;
    for (const id of clave.split(",")) {
      if (id && !cache.has(id) && !pendientes.has(id)) {
        pendientes.add(id);
        nuevos = true;
      }
    }
    if (nuevos) programar();
  }, [clave, sesion]);

  return useMemo(() => {
    const out = new Map<string, EstadoPrecioCuenta>();
    for (const id of clave.split(",")) {
      if (!id) continue;
      const estado = estadoDe(id, valores, { sinLista: noTieneLista, sesion });
      if (estado) out.set(id, estado);
    }
    return out;
  }, [clave, valores, noTieneLista, sesion]);
}
