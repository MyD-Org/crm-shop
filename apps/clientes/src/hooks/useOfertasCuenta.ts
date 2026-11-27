"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { OfertasCuenta } from "@/lib/ofertas-cuenta";
import { sesionPorCookie } from "@/lib/precios-cuenta-estado";

/**
 * Qué ofertas le sirven a la cuenta (`/api/ofertas-cuenta`), compartido por toda la página: la barra,
 * el menú, el bloque de la home y el catálogo hacen un solo pedido. Anónimo: lo público, sin pedido
 * ni marcador. Con sesión: "pendiente" hasta que llega la respuesta (los componentes muestran lo
 * público mientras tanto: no se esconde nada que después aparezca). Sin lista privada, error o
 * respuesta rara: lo público.
 */

const PUBLICO: OfertasCuenta = { tipo: "publico" };
const PENDIENTE: OfertasCuenta = { tipo: "pendiente" };

let estado: OfertasCuenta = PENDIENTE;
let pedido: Promise<void> | null = null;
/** La pista de sesión con la que se pidió: si cambia (login/logout sin recarga), se pregunta de nuevo. */
let sesionDelPedido: boolean | null = null;
const oyentes = new Set<() => void>();

function fijar(nuevo: OfertasCuenta) {
  estado = nuevo;
  for (const o of oyentes) o();
}

function pedir(sesion: boolean) {
  if (pedido && sesionDelPedido === sesion) return;
  sesionDelPedido = sesion;
  if (!sesion) {
    pedido = Promise.resolve();
    fijar(PUBLICO);
    return;
  }
  fijar(PENDIENTE);
  pedido = fetch("/api/ofertas-cuenta", { cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) return fijar(PUBLICO);
      const data = (await res.json()) as { conLista?: boolean; ids?: unknown };
      if (data.conLista !== true || !Array.isArray(data.ids)) return fijar(PUBLICO);
      fijar({ tipo: "privado", ids: new Set(data.ids.filter((x): x is string => typeof x === "string")) });
    })
    .catch(() => fijar(PUBLICO));
}

function suscribir(o: () => void) {
  oyentes.add(o);
  return () => oyentes.delete(o);
}

const leerEstado = () => estado;
const leerEnServidor = () => PUBLICO;
const sinSuscripcion = () => () => {};
const leerSesion = () => sesionPorCookie(document.cookie);
const sesionEnServidor = () => false;

export function useOfertasCuenta(): OfertasCuenta {
  const sesion = useSyncExternalStore(sinSuscripcion, leerSesion, sesionEnServidor);
  const actual = useSyncExternalStore(suscribir, leerEstado, leerEnServidor);
  useEffect(() => {
    pedir(sesion);
  }, [sesion]);
  // Antes del primer efecto (hidratación) y sin sesión: lo público, igual que el servidor.
  return sesion ? actual : PUBLICO;
}

/** Sólo para tests: vuelve el store al estado inicial. */
export function reiniciarOfertasCuenta() {
  estado = PENDIENTE;
  pedido = null;
  sesionDelPedido = null;
}
