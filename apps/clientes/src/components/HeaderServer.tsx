import { Suspense } from "react"
import { connection } from "next/server"
import type { VisibleOn } from "@myd-org/ui"
import { categoriasNav } from "@/lib/catalogo-publico"
import { flagsPublicos } from "@/lib/flags-publicos"
import { accesoFacturacion } from "@/lib/acceso-facturacion"
import { identidadActual } from "@/lib/auth"
import { getContenidoHome } from "@/lib/home-datos"
import { visibilidadDe, type NavBadgeContent } from "@/data/home-defaults"
import { HeaderSinRuta, HeaderUI } from "./HeaderUI"

/**
 * Header global. Va en el shell estático: el badge del nav sale del contenido
 * cacheado de la home, y lo que depende del visitante (identidad) o de un flag
 * (categorías del nav, `catalogo-solo-visibles`) se resuelve en un hueco por
 * request. Mientras tanto se pinta el mismo header con la cuenta "pendiente"
 * (un lugar neutro, nunca "Ingresá") y la barra de categorías reservada.
 */
export async function Header() {
  // Badge administrable del nav (config de home, mismo contrato que el resto
  // del contenido). Cacheado: el layout ya lo lee para el anuncio.
  const { navBadge: badge, visibilidad } = await getContenidoHome()
  const vBadge = visibilidadDe(visibilidad, "navBadge")
  const navBadge = vBadge === "nunca" ? null : badge
  const navBadgeVisibleOn = vBadge === "mobile" || vBadge === "desktop" ? vBadge : undefined

  const pendiente = {
    cuenta: { estado: "pendiente" } as const,
    categorias: null,
    navBadge,
    navBadgeVisibleOn,
  }

  // Fallback de dos pisos: con la ruta (rutas sin parámetros, que se conocen
  // en el prerender: la home reserva la barra de categorías) y, si `usePathname`
  // suspende (ficha, pedido, ingreso), el mismo header sin ruta.
  return (
    <Suspense
      fallback={
        <Suspense fallback={<HeaderSinRuta {...pendiente} />}>
          <HeaderUI {...pendiente} />
        </Suspense>
      }
    >
      <HeaderDinamico navBadge={navBadge} navBadgeVisibleOn={navBadgeVisibleOn} />
    </Suspense>
  )
}

/** Hueco por request: identidad y categorías del nav. */
async function HeaderDinamico({
  navBadge,
  navBadgeVisibleOn,
}: {
  navBadge: NavBadgeContent | null
  navBadgeVisibleOn?: VisibleOn
}) {
  // Las categorias del menu salen del catalogo real, cacheadas y compartidas
  // (`categoriasNav`, tag `catalogo`). Si la lectura falla, el header se
  // renderiza igual: la navegacion no debe tumbar toda la pagina.
  //
  // El nav sólo se muestra en la home (lo decide HeaderUI por la ruta), pero
  // la lectura corre en todas las páginas porque este componente vive en el
  // layout y no sabe dónde está. Con la caché es una consulta y no toca la base.
  //
  // `connection()` primero: marca el hueco como por request antes de tocar la
  // base o los flags (en el prerender no arranca ninguna lectura, y el catch
  // de abajo no confunde el corte del prerender con una base caída).
  await connection()
  const [identidad, esCuentaCorriente, categorias] = await Promise.all([
    identidadActual(),
    // Facturas en el menú: sólo cuenta corriente. Una consulta al espejo (base,
    // nunca Alegra) y sólo con vínculo; compartida por request con Mi cuenta.
    // Si falla, el menú va sin Facturas.
    accesoFacturacion(),
    flagsPublicos()
      .then(({ soloVisibles }) => categoriasNav(soloVisibles))
      .catch((err: unknown) => {
        console.error("[Header] no se pudieron cargar las categorias:", err)
        return [] as string[]
      }),
  ])

  return (
    <HeaderUI
      cuenta={{
        estado: "resuelta",
        // El nombre comercial le gana al de Google: el cliente se reconoce por
        // su razon social, no por como se llama su cuenta de Gmail.
        nombre: identidad.cliente?.razonsocial ?? identidad.nombre ?? identidad.email ?? null,
        conSesion: identidad.clerkUserId !== null,
        esCuentaCorriente,
      }}
      // La vinculacion de cuenta corriente NO va en el header: ocupa mucho para
      // algo que la mayoria no necesita, y se busca en "Mi cuenta > Mis datos".
      categorias={categorias}
      navBadge={navBadge}
      navBadgeVisibleOn={navBadgeVisibleOn}
    />
  )
}
