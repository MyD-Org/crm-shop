import { NextResponse } from "next/server";
import type { Product } from "@/data/products";
import { productoPublico } from "@/lib/catalogo-publico";
import { flagsPublicos } from "@/lib/flags-publicos";
import { esIdProducto } from "@/lib/id-producto";
import { permitirAsync } from "@/lib/rate-limit";
import { ipDe } from "@/lib/ubicacion-api";
import { dispCatalogo } from "@/lib/zona-servidor";

const USOS_POR_MINUTO = 60;

/** Precio y stock públicos: se pueden guardar un rato en el navegador de quien los pidió. */
const CACHE = { "Cache-Control": "private, max-age=30" };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers });
}

/** Lo que el panel necesita de una opción: sin la ficha, las características ni más de una foto. */
function liviano(p: Product): Product {
  const { description, especificaciones, atributosEstructurados, fichaTecnicaUrl, images, ...resto } = p;
  void description;
  void especificaciones;
  void atributosEstructurados;
  void fichaTecnicaUrl;
  return { ...resto, ...(images?.length ? { images: images.slice(0, 1) } : {}) };
}

/**
 * GET /api/shop/variantes?id=<id de producto> → `{ nombre, marca, representanteId, opciones: Product[] }`.
 *
 * Las opciones de un modelo, para el panel «Agregar» de la card del listado (flag `variantes-selector`):
 * se piden recién al abrir el panel, no viajan con el listado. Es la misma lectura que la ficha
 * (`productoPublico` con `agrupar`): sólo variantes activas, con precio y visibles, con el tenant en el
 * WHERE. Los precios son los PÚBLICOS; el de la lista privada de la cuenta se superpone en el navegador
 * (`usePreciosCuenta`). Flag apagado, id inválido o producto sin opciones: error en usted.
 */
export async function GET(req: Request) {
  if (!(await permitirAsync(`shop-variantes:${ipDe(req)}`, USOS_POR_MINUTO, 60_000))) {
    return json({ error: "Demasiadas consultas. Inténtelo de nuevo en un momento." }, 429);
  }
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!esIdProducto(id)) return json({ error: "Producto no válido." }, 400);
  try {
    const { soloVisibles, variantes, mediosPrecio } = await flagsPublicos();
    if (!variantes) return json({ error: "Este producto no tiene opciones." }, 404);
    const disp = await dispCatalogo();
    const producto = await productoPublico(
      id,
      soloVisibles,
      disp,
      false,
      mediosPrecio?.ficha,
      mediosPrecio?.cuotas,
      mediosPrecio?.modal,
      true,
    );
    const grupo = producto?.grupo;
    if (!producto || !grupo) return json({ error: "Este producto no tiene opciones." }, 404);
    return json(
      {
        nombre: producto.name,
        marca: producto.brand,
        representanteId: grupo.representanteId,
        opciones: grupo.opciones.map((o) => liviano(o.producto)),
      },
      200,
      CACHE,
    );
  } catch (err) {
    console.error(`[shop/variantes] ${err instanceof Error ? err.name : "desconocido"}`);
    return json({ error: "No se pudieron cargar las opciones." }, 503);
  }
}
