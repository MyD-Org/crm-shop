import { Suspense, type ReactNode } from "react";
import { Breadcrumb } from "@myd-org/ui";
import { linkNext } from "@/components/catalogo/link-next";
import {
  BLOQUES_POR_NIVEL,
  hrefMarca,
  visibilidadBloque,
  type BloqueMarca,
  type PaginaMarca,
} from "@/lib/marcas/pagina-marca";
import { BloqueMarcaEditable } from "./edicion/BloqueMarcaEditable";
import { propsTemaOficial } from "./tema-oficial";
import {
  ComponentesBloque,
  ConfianzaBloque,
  CotizacionBloque,
  EmpresaBloque,
  HeroMarcaBloque,
  LineasBloque,
  ObrasBloque,
} from "./bloques/BloquesMarca";
import { ElegidosMarcaBloque, ElegidosMarcaSkeleton, ProductosMarcaBloque } from "./bloques/ProductosMarca";

/**
 * Una página de marca armada bloque por bloque, en el orden de su nivel y con
 * la visibilidad de cada uno (spec 2026-10-20 §3 y §4). Nivel "oficial": todo
 * menos "Todos los productos" va dentro de `data-tema-marca="oficial"` (negro
 * con el acento de la marca); el bloque de productos vuelve al tema de la
 * tienda, con sus cards de siempre.
 *
 * Cada bloque va en `BloqueMarcaEditable`: para un visitante solo aplica la
 * visibilidad; para un admin en modo edición agrega el botón "Editar".
 */
export function PaginaMarcaVista({
  pagina,
  estado,
  query,
  total,
  cotizar,
}: {
  pagina: PaginaMarca;
  estado: { pagina: number; linea?: string };
  /** Search params crudos (filtros del catálogo dentro de la marca). */
  query: Record<string, string | string[] | undefined>;
  total: number | null;
  /** A dónde lleva "cotizar" (`hrefCotizacion`; null = sin destino válido: el bloque no se dibuja). */
  cotizar: string | null;
}) {
  const b = pagina.bloques;
  const bloque = (nombre: BloqueMarca, contenido: ReactNode) => (
    <BloqueMarcaEditable key={nombre} slug={pagina.slug} bloque={nombre} visibilidad={visibilidadBloque(pagina, nombre)}>
      {contenido}
    </BloqueMarcaEditable>
  );
  const render: Record<BloqueMarca, () => ReactNode> = {
    hero: () => bloque("hero", <HeroMarcaBloque pagina={pagina} hero={b.hero} total={total} />),
    confianza: () => bloque("confianza", b.confianza ? <ConfianzaBloque confianza={b.confianza} /> : null),
    lineas: () => bloque("lineas", b.lineas ? <LineasBloque pagina={pagina} lineas={b.lineas} lineaActual={estado.linea} /> : null),
    elegidos: () =>
      bloque(
        "elegidos",
        b.elegidos ? (
          <Suspense fallback={<ElegidosMarcaSkeleton cantidad={b.elegidos.cantidad} />}>
            <ElegidosMarcaBloque pagina={pagina} elegidos={b.elegidos} />
          </Suspense>
        ) : null,
      ),
    componentes: () => bloque("componentes", b.componentes ? <ComponentesBloque componentes={b.componentes} /> : null),
    empresa: () => bloque("empresa", b.empresa ? <EmpresaBloque empresa={b.empresa} /> : null),
    obras: () => bloque("obras", b.obras ? <ObrasBloque obras={b.obras} /> : null),
    cotizacion: () => bloque("cotizacion", b.cotizacion ? <CotizacionBloque cotizacion={b.cotizacion} href={cotizar} /> : null),
    productos: () =>
      bloque(
        "productos",
        <Suspense fallback={<div id="productos" className="min-h-[50vh]" />}>
          <ProductosMarcaBloque pagina={pagina} titulo={b.productos?.titulo} query={query} linea={estado.linea} />
        </Suspense>,
      ),
  };

  const orden = BLOQUES_POR_NIVEL[pagina.nivel];
  const deMarca = orden.filter((n) => n !== "productos");
  const migas = (
    <div className="mx-auto w-full max-w-contenido px-[clamp(18px,4vw,48px)] py-3">
      <Breadcrumb
        items={[{ label: "Inicio", href: "/" }, { label: pagina.nombre }]}
        renderLink={linkNext}
      />
    </div>
  );

  if (pagina.nivel === "marca") {
    return (
      <main className="flex-1" data-fotos-con-aire="">
        {migas}
        {orden.map((n) => render[n]())}
      </main>
    );
  }
  return (
    <main className="flex-1" data-pagina-marca={hrefMarca(pagina.slug)} data-fotos-con-aire="">
      <div {...propsTemaOficial(pagina)}>
        {migas}
        {deMarca.map((n) => render[n]())}
      </div>
      {render.productos()}
    </main>
  );
}
