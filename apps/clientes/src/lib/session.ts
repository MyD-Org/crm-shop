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
  password: process.env.SESSION_SECRET ?? "development-secret-change-in-production-32chars",
  cookieName: "portal-session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    domain: process.env.COOKIE_DOMAIN,
  },
}
