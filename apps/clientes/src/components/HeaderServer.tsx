import { cookies } from "next/headers"
import { getIronSession } from "iron-session"
import { sessionOptions, type SessionData } from "@/lib/session"
import { HeaderUI } from "./HeaderUI"

export async function Header() {
  const cookieStore = await cookies()
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions)

  return (
    <HeaderUI
      sesion={session.isLoggedIn ? { nombre: session.razonsocial ?? session.email ?? "Mi cuenta" } : null}
    />
  )
}
