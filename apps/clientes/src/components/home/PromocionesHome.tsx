import { connection } from "next/server";
import type { PromocionesContent } from "@/data/home-defaults";
import { productosPromo } from "@/lib/catalogo-publico";
import { flagsPublicos } from "@/lib/flags-publicos";
import { estadoPromo, skusPromo, unidadesQuedan } from "@/lib/promociones/promo";
import { stockEnSucursal, sucursalesDePromo } from "@/lib/promociones/stock";
import { leerSucursalesYZonas } from "@/lib/sucursales-repo";
import { dispCatalogo } from "@/lib/zona-servidor";
import { PromocionesVista } from "./PromocionesVista";

/**
 * Sección "Promociones" de la home (spec 2026-10-26-promociones-home §5). Hueco por request: la
 * vigencia se calcula acá, fuera de toda caché (el contenido de la home vive un día cacheado), y el
 * stock de la sucursal de la promo se lee sin caché. Los productos salen de la caché del catálogo.
 */
export async function PromocionesHome({ contenido }: { contenido: PromocionesContent }) {
  await connection();
  const estado = estadoPromo(contenido, ahoraServidor());
  const skus = skusPromo(contenido);

  const [{ soloVisibles, variantes, mediosPrecio }, disp] = await Promise.all([flagsPublicos(), dispCatalogo()]);
  const productos = await productosPromo({
    skus,
    soloVisibles,
    ...(variantes ? { agrupar: true } : {}),
    disp,
    destacado: mediosPrecio?.destacado,
    cuotas: mediosPrecio?.cuotas,
  });
  const porSku = new Map(productos.map((p) => [(p.sku ?? "").toUpperCase(), p]));
  const skuEstrella = contenido.estrella?.sku.trim().toUpperCase();
  const prodEstrella = skuEstrella ? porSku.get(skuEstrella) : undefined;

  let quedan: number | null = null;
  if (prodEstrella && contenido.estrella?.unidadesPromo) {
    quedan = await quedanDeEstrella(contenido, prodEstrella.id);
  }

  // Los items sin stock no se ofrecen; la estrella sin stock se muestra agotada (nunca "Agregar").
  const items = contenido.items
    .map((i) => porSku.get(i.sku.trim().toUpperCase()))
    .filter((p): p is NonNullable<typeof p> => !!p && p.stock !== "out" && p !== prodEstrella);

  return (
    <PromocionesVista
      contenido={contenido}
      estrella={prodEstrella ? { producto: prodEstrella, quedan } : null}
      items={items}
      estado={estado}
    />
  );
}

/** Unidades que quedan según el stock de la sucursal de la promo (ver `unidadesQuedan`). */
async function quedanDeEstrella(contenido: PromocionesContent, id: string): Promise<number | null> {
  const e = contenido.estrella!;
  try {
    const sucursales = sucursalesDePromo((await leerSucursalesYZonas()).sucursales);
    const predeterminada = sucursales[0]?.slug;
    const sucursal = e.sucursal ?? predeterminada;
    if (!sucursal || !predeterminada) return null;
    const stock = (await stockEnSucursal([id], sucursal, predeterminada))[id];
    // No inventariable: sin ventas que descontar (el contador queda en el total).
    if (stock === null) return e.unidadesPromo ?? null;
    return unidadesQuedan(e, stock ?? 0);
  } catch (err) {
    console.error("[promociones] no se pudo leer el stock de la estrella:", err);
    return null;
  }
}

/** Fuera del componente: la hora del request (después de `connection()`, nunca cacheada). */
function ahoraServidor(): number {
  return Date.now();
}
