import { redirect } from "next/navigation"

// El correo vive como solapas dentro de Mensajes. Esta ruta redirige (conservando ?casilla= y
// ?hilo=) por si quedó algún enlace o aviso con la dirección vieja.
export default async function CorreoPage({ searchParams }: { searchParams: Promise<{ casilla?: string; hilo?: string }> }) {
  const { casilla, hilo } = await searchParams
  const qs = new URLSearchParams()
  if (casilla) qs.set("casilla", casilla)
  if (hilo) qs.set("hilo", hilo)
  redirect(`/admin/inbox${qs.size ? `?${qs}` : ""}`)
}
