"use client";

import { Pagination } from "@myd-org/ui";
import { linkNext } from "@/components/catalogo/link-next";
import { hrefPaginaMarca } from "@/lib/marcas/vista-marca";

/**
 * Paginación de "Todos los productos" de una página de marca. De cliente porque `hrefFor` es una
 * función: un Server Component no se la puede pasar al `Pagination` del DS (no se serializa).
 */
export function PaginacionMarca({
  slug,
  linea,
  pagina,
  paginas,
}: {
  slug: string;
  linea?: string;
  pagina: number;
  paginas: number;
}) {
  return (
    <Pagination
      className="mt-8"
      page={pagina}
      totalPages={paginas}
      hrefFor={(n) => hrefPaginaMarca(slug, n, linea)}
      renderLink={linkNext}
    />
  );
}
