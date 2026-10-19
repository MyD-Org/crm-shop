import type { InboxContact, MessageAttachment, SharedContact, SharedLocation } from "@/lib/inbox-api"

// Lógica pura de las tarjetas de contacto y ubicación que se dibujan en el hilo del inbox.

/** Contacto y ubicación no traen archivo: el adjunto ya es el dato a mostrar. */
export function esAdjuntoDeDatos(att: MessageAttachment): boolean {
  return "contacts" in att || "location" in att
}

export function soloDigitos(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "")
}

/** Número con el que se busca la conversación: el wa_id si vino, si no los dígitos del teléfono. */
export function numeroDelContacto(contact: SharedContact): string | null {
  for (const p of contact.phones) {
    const n = soloDigitos(p.waId) || soloDigitos(p.phone)
    if (n) return n
  }
  return null
}

/** Teléfono para mostrar: el formateado si vino, si no el wa_id con "+". */
export function telefonoVisible(p: { phone?: string; waId?: string }): string {
  return p.phone || (p.waId ? `+${p.waId}` : "")
}

export function inicial(contact: SharedContact): string {
  return (contact.name?.trim()[0] ?? "?").toUpperCase()
}

/**
 * Busca la conversación de ese número en el inbox. Si se conoce el canal del hilo actual,
 * se prefiere ese: cada número del negocio es un hilo aparte, y la idea es seguir por el
 * mismo número por el que llegó el contacto. Si en ese canal no hay, sirve cualquiera.
 */
export function buscarConversacion(
  contacts: Pick<InboxContact, "phone" | "channel_account_id" | "end_user_id">[],
  numero: string,
  channelAccountId?: string | null,
) {
  const delNumero = contacts.filter((c) => soloDigitos(c.phone) === numero)
  return delNumero.find((c) => channelAccountId && c.channel_account_id === channelAccountId) ?? delNumero[0] ?? null
}

export function mapsUrl(location: SharedLocation): string {
  return `https://www.google.com/maps?q=${location.latitude},${location.longitude}`
}

export function coordenadas(location: SharedLocation): string {
  return `${location.latitude}, ${location.longitude}`
}
