import { campaniasShop, campaniasVigentes } from "@/lib/campanias/vigentes";
import { connection } from "next/server";
import type { PromocionesContent } from "@/data/home-defaults";
import { productosPromo } from "@/lib/catalogo-publico";
import { flagsPublicos } from "@/lib/flags-publicos";
import { contenidoConCampania, estadoPromo, skusNoResueltos, skusPromo } from "@/lib/promociones/promo";
import { quedanEstrella } from "@/lib/promociones/stock";
import { dispCatalogo } from "@/lib/zona-servidor";
import { PromocionesVista } from "./PromocionesVista";

/**
 * Sección "Promociones" de la home (spec 2026-10-26-promociones-home §5). Hueco por request: la
 * vigencia se calcula acá, fuera de toda caché (el contenido de la home vive un día cacheado), y el
 * stock de la sucursal de la promo se lee sin caché. Los productos salen de la caché del catálogo.
 */
export async function PromocionesHome({ contenido: guardado }: { contenido: PromocionesContent }) {
  await connection();
  const skus = skusPromo(guardado);

  const [{ soloVisibles, variantes, mediosPrecio }, disp, campanias, ventanas] = await Promise.all([
    flagsPublicos(),
    dispCatalogo(),
    campaniasVigentes(),
    // Sección asociada a una campaña de precios: sus fechas (aunque todavía no haya empezado).
    guardado.campaniaId ? campaniasShop() : Promise.resolve([]),
  ]);
  const productos = await productosPromo({
    skus,
    soloVisibles,
    ...(variantes ? { agrupar: true } : {}),
    disp,
    destacado: mediosPrecio?.destacado,
    cuotas: mediosPrecio?.cuotas,
    campanias,
  });
  // Con campaña de precios: fechas, precio habitual tachado y unidades de la estrella salen de ella.
  const contenido = contenidoConCampania(
    guardado,
    ventanas.find((c) => c.id === guardado.campaniaId),
    productos,
  );
  const estado = estadoPromo(contenido, ahoraServidor());
  const porSku = new Map(productos.map((p) => [(p.sku ?? "").toUpperCase(), p]));
  const skuEstrella = contenido.estrella?.sku.trim().toUpperCase();
  const prodEstrella = skuEstrella ? porSku.get(skuEstrella) : undefined;

  let quedan: number | null = null;
  if (prodEstrella?.campania?.unidades != null) {
    // Límite de la campaña: lo que queda ya viene contado en el producto (pedidos de la tienda).
    quedan = prodEstrella.campania.quedan;
  } else if (prodEstrella && contenido.estrella?.unidadesPromo) {
    quedan = await quedanEstrella(contenido.estrella, prodEstrella.id);
  }

  // Los items sin stock no se ofrecen; la estrella sin stock se muestra agotada (nunca "Agregar").
  const items = contenido.items
    .map((i) => porSku.get(i.sku.trim().toUpperCase()))
    .filter((p): p is NonNullable<typeof p> => !!p && p.stock !== "out" && p !== prodEstrella);

  // Lo cargado que no se dibuja (oculto, borrado o item sin stock): el admin lo ve en "Modo edición".
  const noResueltos = skusNoResueltos(
    contenido,
    [prodEstrella, ...items].flatMap((p) => (p?.sku ? [p.sku] : [])),
  );

  return (
    <PromocionesVista
      contenido={contenido}
      estrella={prodEstrella ? { producto: prodEstrella, quedan } : null}
      items={items}
      estado={estado}
      noResueltos={noResueltos}
    />
  );
}

/** Fuera del componente: la hora del request (después de `connection()`, nunca cacheada). */
function ahoraServidor(): number {
  return Date.now();
}
