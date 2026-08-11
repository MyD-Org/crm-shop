import { getCategorias } from "@/lib/catalog"
import { identidadActual } from "@/lib/auth"
import { HeaderUI } from "./HeaderUI"

export async function Header() {
  const identidad = await identidadActual()

  // Las categorias del menu salen del catalogo real. Si Alegra falla, el header
  // se renderiza igual: la navegacion no debe tumbar toda la pagina.
  let categorias: string[] = []
  try {
    categorias = await getCategorias()
  } catch (err) {
    console.error("[Header] no se pudieron cargar las categorias:", err)
  }

  return (
    <HeaderUI
      // El nombre comercial le gana al de Google: el cliente se reconoce por su
      // razon social, no por como se llama su cuenta de Gmail.
      nombre={
        identidad.cliente?.razonsocial ??
        identidad.nombre ??
        identidad.email ??
        null
      }
      // La vinculacion de cuenta corriente NO va en el header: ocupa mucho para
      // algo que la mayoria no necesita, y se busca en "Mi cuenta > Mis datos".
      categorias={categorias}
    />
  )
}
