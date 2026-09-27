"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Product } from "@/data/products";
import type { PrecioCuenta } from "@/lib/precio-cuenta";

/**
 * Precios especiales de la cuenta, superpuestos en el navegador sobre el
 * catálogo cacheado (que viene con la lista general). Todas las tarjetas de la
 * página comparten un store: los ids se juntan en un solo pedido por tanda y
 * cada id se pregunta una vez. Si el servidor dice que el visitante no tiene
 * lista propia, no se pregunta más.
 */

const cache = new Map<string, PrecioCuenta | null>();
const pendientes = new Set<string>();
const oyentes = new Set<() => void>();
let sinListaPropia = false;
let programado = false;
/** Copia inmutable de `cache` para React: cambia de identidad en cada tanda. */
let instantanea: ReadonlyMap<string, PrecioCuenta | null> = new Map();
const VACIO: ReadonlyMap<string, PrecioCuenta | null> = new Map();

function avisar() {
  instantanea = new Map(cache);
  for (const o of oyentes) o();
}

async function pedir() {
  programado = false;
  const ids = [...pendientes].slice(0, 60);
  for (const id of ids) pendientes.delete(id);
  if (ids.length === 0 || sinListaPropia) return;
  try {
    const res = await fetch(`/api/precios-cuenta?ids=${ids.join(",")}`, { cache: "no-store" });
    if (!res.ok) return; // Sin precio especial se muestra el de lista: no rompe nada.
    const data = (await res.json()) as { especial: boolean; precios: Record<string, PrecioCuenta> };
    if (!data.especial) {
      sinListaPropia = true;
      return;
    }
    for (const id of ids) cache.set(id, data.precios[id] ?? null);
    avisar();
  } catch {
    // Idem: sin red se queda el precio de lista.
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
const leerVacio = () => VACIO;

/** Precio especial de cada id (ausente = no tiene o todavía no se sabe). */
export function usePreciosCuenta(ids: readonly string[]): ReadonlyMap<string, PrecioCuenta | null> {
  const precios = useSyncExternalStore(suscribir, leerInstantanea, leerVacio);
  const clave = ids.join(",");
  useEffect(() => {
    if (sinListaPropia) return;
    let nuevos = false;
    for (const id of clave.split(",")) {
      if (id && !cache.has(id) && !pendientes.has(id)) {
        pendientes.add(id);
        nuevos = true;
      }
    }
    if (nuevos) programar();
  }, [clave]);
  return precios;
}

/**
 * El producto con el precio de la cuenta aplicado: `price`/`precioFinal` pasan
 * a ser los del cliente y `oldPrice` el de lista (para tacharlo). Sin precio
 * especial devuelve el mismo objeto.
 */
export function conPrecioCuenta(p: Product, precio: PrecioCuenta | null | undefined): Product {
  if (!precio) return p;
  return {
    ...p,
    price: precio.price,
    precioFinal: precio.precioFinal,
    oldPrice: p.precioFinal ?? p.price,
    precioEspecial: true,
  };
}
