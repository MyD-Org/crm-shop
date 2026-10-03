// Estado de entrega de un mensaje saliente, a partir del `last_event` que informa Resend en
// GET /emails/{id}. Puro: sin red.

export interface AvisoEntrega {
  tono: "danger" | "warning"
  texto: string
}

const AVISOS: Record<string, AvisoEntrega> = {
  bounced: { tono: "danger", texto: "No entregado: la dirección no existe o rechazó el mensaje." },
  failed: { tono: "danger", texto: "No entregado: no se pudo enviar el mensaje." },
  complained: { tono: "danger", texto: "No entregado: el destinatario lo marcó como spam." },
  suppressed: { tono: "danger", texto: "No entregado: la dirección está en la lista de supresión." },
  delivery_delayed: { tono: "warning", texto: "Entrega demorada." },
}

/** Aviso para mostrar en el hilo; null si el último evento no indica ningún problema. */
export function avisoDeEntrega(lastEvent: string | null | undefined): AvisoEntrega | null {
  return (lastEvent && AVISOS[lastEvent]) || null
}
