import { cookies } from "next/headers"
import { getIronSession } from "iron-session"
import { sessionOptions, type SessionData } from "@/lib/session"
import { getCategorias } from "@/lib/catalog"
import { HeaderUI } from "./HeaderUI"

export async function Header() {
  const cookieStore = await cookies()
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions)

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
      sesion={session.isLoggedIn ? { nombre: session.razonsocial ?? session.email ?? "Mi cuenta" } : null}
      categorias={categorias}
    />
  )
}
