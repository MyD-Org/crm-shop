import { type SessionOptions } from "iron-session"

export interface SessionData {
  codigocliente?: string
  razonsocial?: string
  cuit?: string
  email?: string
  tipoCuenta?: "corriente" | "contado"
  isLoggedIn: boolean
}

// Misma config que el CRM — cookie compartida en .cliente.example
export const sessionOptions: SessionOptions = {
  // Getter: se evalua al atender el request, no al importar el modulo, para no
  // romper el build donde la variable todavia no este cargada. Sin default a
  // proposito: un secreto fijo en el repo permitiria falsificar sesiones.
  get password() {
    const secret = process.env.SESSION_SECRET
    if (!secret) {
      throw new Error(
        "Falta SESSION_SECRET en el entorno. Debe ser el mismo valor que en el CRM para compartir la cookie de sesion. Revisar .env.local."
      )
    }
    return secret
  },
  cookieName: "portal-session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    domain: process.env.COOKIE_DOMAIN,
  },
}
