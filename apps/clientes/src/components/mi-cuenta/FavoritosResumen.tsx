import type { Product } from "@/data/products";
import { RUTAS_MI_CUENTA } from "@/lib/mi-cuenta-nav";
import { FavoritosLista } from "./FavoritosLista";
import { SeccionTitulo } from "./SeccionTitulo";

/**
 * "Sus favoritos" en el resumen: los más recientes (el llamador trae hasta 4) y
 * "Ver todos" sólo si hay alguno. Sin cuotas: el resumen no consulta la oferta
 * para no sumar lecturas; la línea de cuotas está en la página de favoritos.
 */
export function FavoritosResumen({ productos }: { productos: Product[] }) {
  return (
    <section aria-labelledby="sus-favoritos">
      <SeccionTitulo
        id="sus-favoritos"
        titulo="Sus favoritos"
        href={productos.length > 0 ? RUTAS_MI_CUENTA.favoritos : undefined}
      />
      <FavoritosLista productos={productos} oferta={null} />
    </section>
  );
}
