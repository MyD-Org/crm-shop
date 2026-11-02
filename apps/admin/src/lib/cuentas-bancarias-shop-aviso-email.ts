// Mail de aviso por cambios en las cuentas bancarias de la tienda (alta, edición, activación /
// desactivación, baja). Va a todos los admin y superadmin del tenant: si alguien roba una
// contraseña y cambia el CBU de cobro, el cambio no pasa desapercibido.
//
// Módulo PURO (sin db, env ni red): calcula el diff y arma el mail. El envío está en
// `cuentas-bancarias-shop-aviso.ts`. El CBU/CVU se muestra enmascarado (últimos 4 dígitos): el
// mail no es un volcado de datos.

import type { CuentaBancariaDto } from "@/lib/cuentas-bancarias-shop-repo"
import { emailCardHtml, emailDocumentHtml, escapeHtml, oneLine, saludo } from "@/lib/email-layout"

export type TipoCambioCuenta = "alta" | "edicion" | "baja"

export interface CambioCampo {
  etiqueta: string
  antes: string
  despues: string
}

type Campo = { etiqueta: string; valor: (c: CuentaBancariaDto) => string }

const VACIO = "(vacío)"
const txt = (v: string) => (v.trim() ? v : VACIO)

/** "•••• 1234": sólo los últimos 4 dígitos de un CBU/CVU. */
export function enmascararCbu(cbu: string): string {
  const d = cbu.replace(/\s+/g, "")
  if (!d) return VACIO
  return `•••• ${d.slice(-4)}`
}

const monto = (n: number | null) => (n === null ? "sin límite" : String(n))

const CAMPOS: Campo[] = [
  { etiqueta: "Alias", valor: (c) => txt(c.alias) },
  { etiqueta: "CBU/CVU", valor: (c) => enmascararCbu(c.cbu) },
  { etiqueta: "Banco", valor: (c) => txt(c.banco) },
  { etiqueta: "Titular", valor: (c) => txt(c.titular) },
  { etiqueta: "CUIT", valor: (c) => txt(c.cuit) },
  { etiqueta: "Estado", valor: (c) => (c.activa ? "Activa" : "Inactiva") },
  { etiqueta: "Predeterminada", valor: (c) => (c.predeterminada ? "Sí" : "No") },
  { etiqueta: "Sucursales", valor: (c) => (c.todasLasSucursales ? "Todas" : c.sucursalSlugs.join(", ") || "Ninguna") },
  { etiqueta: "Monto mínimo", valor: (c) => monto(c.montoMin) },
  { etiqueta: "Monto máximo", valor: (c) => monto(c.montoMax) },
]

/** Campos que cambiaron entre `antes` y `despues`, con valores ya enmascarados/legibles. */
export function diffCuenta(antes: CuentaBancariaDto, despues: CuentaBancariaDto): CambioCampo[] {
  const out: CambioCampo[] = []
  for (const c of CAMPOS) {
    // El CBU se compara por su valor real (los últimos 4 podrían coincidir); el resto, por el texto mostrado.
    const cambio = c.etiqueta === "CBU/CVU" ? antes.cbu !== despues.cbu : c.valor(antes) !== c.valor(despues)
    if (cambio) out.push({ etiqueta: c.etiqueta, antes: c.valor(antes), despues: c.valor(despues) })
  }
  return out
}

export interface AvisoCuentaInput {
  tenantName: string
  logoUrl?: string | null
  /** Destinatario (para el saludo). */
  nombreDestinatario: string
  tipo: TipoCambioCuenta
  actor: { name: string; email: string }
  fecha: Date
  /** Estado previo (edición, baja). */
  antes?: CuentaBancariaDto | null
  /** Estado nuevo (alta, edición). */
  despues?: CuentaBancariaDto | null
}

const ZONA = "America/Argentina/Buenos_Aires"

export function formatearFechaAviso(fecha: Date): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "long", timeStyle: "short", timeZone: ZONA, hour12: false }).format(fecha)
}

const ADVERTENCIA = "Si no reconoce este cambio, revise la cuenta de inmediato y cambie su contraseña."

/** Filas "etiqueta: valor" para alta/baja (datos principales, CBU enmascarado). */
function resumen(c: CuentaBancariaDto): CambioCampo[] {
  return CAMPOS.slice(0, 7).map((f) => ({ etiqueta: f.etiqueta, antes: "", despues: f.valor(c) }))
}

/** Devuelve null si no hay nada que avisar (edición sin cambios). */
export function buildCuentaBancariaAvisoEmail(
  input: AvisoCuentaInput,
): { subject: string; html: string; text: string } | null {
  const ref = input.tipo === "baja" ? input.antes : input.despues
  if (!ref) return null

  let cambios: CambioCampo[]
  let intro: string
  if (input.tipo === "edicion") {
    if (!input.antes || !input.despues) return null
    cambios = diffCuenta(input.antes, input.despues)
    if (cambios.length === 0) return null
    intro = "Se modificó una cuenta bancaria de la tienda."
  } else if (input.tipo === "alta") {
    cambios = resumen(ref)
    intro = "Se agregó una cuenta bancaria a la tienda."
  } else {
    cambios = resumen(ref)
    intro = "Se eliminó una cuenta bancaria de la tienda."
  }

  const subject = oneLine(
    input.tipo === "alta"
      ? "Se agregó una cuenta bancaria de la tienda"
      : input.tipo === "baja"
        ? "Se eliminó una cuenta bancaria de la tienda"
        : "Se modificó una cuenta bancaria de la tienda",
  )
  const quien = `${oneLine(input.actor.name)} (${oneLine(input.actor.email)})`
  const cuando = formatearFechaAviso(input.fecha)
  const cuentaTxt = `${oneLine(ref.alias)} — CBU/CVU ${enmascararCbu(ref.cbu)}`
  const saludoTexto = saludo(oneLine(input.nombreDestinatario))
  const encabezados = [`Realizado por: ${quien}`, `Fecha: ${cuando}`, `Cuenta: ${cuentaTxt}`]

  const mostrarAntes = input.tipo === "edicion"
  const filasLineas = cambios.map((c) =>
    mostrarAntes ? `- ${c.etiqueta}: ${c.antes} → ${c.despues}` : `- ${c.etiqueta}: ${c.despues}`,
  )

  const e = escapeHtml
  const filasHtml = cambios
    .map(
      (c) =>
        `<tr><td style="padding:4px 8px 4px 0;color:#77808a;vertical-align:top">${e(c.etiqueta)}</td><td style="padding:4px 0">${
          mostrarAntes ? `${e(c.antes)} &rarr; <strong>${e(c.despues)}</strong>` : e(c.despues)
        }</td></tr>`,
    )
    .join("")
  const contenidoHtml =
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;margin:8px 0">${filasHtml}</table>` +
    `<p style="margin:12px 0 0;font-size:14px;font-weight:600">${e(ADVERTENCIA)}</p>`

  const html = emailDocumentHtml(
    emailCardHtml({
      tenantName: input.tenantName,
      logoUrl: input.logoUrl,
      preheader: intro,
      titulo: subject,
      parrafos: [saludoTexto, intro, ...encabezados],
      contenidoHtml,
      pie: "Recibe este aviso por ser administrador de la tienda.",
    }),
    subject,
  )

  const text = [subject, "", saludoTexto, intro, "", ...encabezados, "", ...filasLineas, "", ADVERTENCIA].join("\n")
  return { subject, html, text }
}
