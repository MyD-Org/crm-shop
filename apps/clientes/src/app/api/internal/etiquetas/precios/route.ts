import { NextResponse } from "next/server";
import { getProductosPorIds } from "@/lib/catalog";
import { campaniasVigentes } from "@/lib/campanias/vigentes";
import { flagsPublicos } from "@/lib/flags-publicos";
import { esIdProducto } from "@/lib/id-producto";
import { SIN_MEDIOS_PRECIO } from "@/lib/medios-precio";
import { rotuloMedio } from "@/lib/precio-medio-texto";
import { bearerMatches } from "@/lib/secure-compare";

/** Tope de ids por pedido: el mismo que "Agregar todos los de la marca" del CRM. */
const MAX_IDS_ETIQUETAS = 1000;

const SIN_CACHE = { "Cache-Control": "private, no-store" };

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: SIN_CACHE });

/** Precio de un producto tal como lo muestra la card del catálogo a un visitante (con IVA si se conoce). */
export interface PrecioEtiquetaShop {
  /** Precio principal de la card (`precioFinal ?? price`); null = sin precio publicable. */
  precioLista: number | null;
  /** "$X con <Medio>" del medio destacado; null = no hay línea en la card. */
  precioMedio: { nombre: string; rotulo: string; precio: number } | null;
}

/**
 * POST /api/internal/etiquetas/precios — contrato CRM → Shop (etiquetas de precio del CRM).
 *
 * Body `{ ids: string[] }` (alegraIds). Responde `{ precios: { [alegraId]: PrecioEtiquetaShop } }`;
 * un id que la tienda no tiene no aparece.
 *
 * Los precios salen de la MISMA cadena que la card del catálogo (`getProductosPorIds` →
 * `mapFilaToProduct`): lista pública (sin sesión, nunca la lista privada de un cliente), IVA,
 * campañas vigentes y el medio destacado de `flagsPublicos()` ("$X con Transferencia"). No filtra
 * por publicado: un producto oculto en la web también puede llevar etiqueta en el local.
 *
 * Autenticado con `SHOP_CRM_SECRET` (Bearer), la misma llave que los avisos de revalidación. Está
 * en RUTAS_PUBLICAS del gate (src/proxy.ts) para que la cortina no conteste HTML.
 */
export async function POST(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.SHOP_CRM_SECRET)) {
    return json({ error: "unauthorized" }, 401);
  }

  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return json({ error: "body_invalido" }, 400);
  }
  const crudos = (cuerpo as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(crudos) || crudos.length > MAX_IDS_ETIQUETAS) return json({ error: "ids_invalidos" }, 400);
  const ids = [...new Set(crudos.filter((x): x is string => typeof x === "string" && esIdProducto(x)))];
  if (ids.length === 0) return json({ precios: {} });

  try {
    const [{ mediosPrecio }, campanias] = await Promise.all([flagsPublicos(), campaniasVigentes()]);
    const productos = await getProductosPorIds(ids, {
      // Como las cards del catálogo: el medio destacado y las campañas activas.
      ...(mediosPrecio.destacado || campanias.length
        ? {
            mediosPrecio: {
              ...SIN_MEDIOS_PRECIO,
              destacado: mediosPrecio.destacado,
              ...(campanias.length ? { campanias } : {}),
            },
          }
        : {}),
    });
    const precios: Record<string, PrecioEtiquetaShop> = {};
    for (const [id, p] of productos) {
      const lista = p.precioFinal ?? p.price;
      const m = p.precioMedio;
      precios[id] = {
        precioLista: Number.isFinite(lista) && lista > 0 ? lista : null,
        precioMedio: m
          ? { nombre: m.nombre, rotulo: rotuloMedio(m), precio: m.precioFinal ?? m.price }
          : null,
      };
    }
    return json({ precios });
  } catch (err) {
    console.error(`[etiquetas/precios] ${err instanceof Error ? err.name : "desconocido"}`);
    return json({ error: "No se pudieron obtener los precios." }, 502);
  }
}
