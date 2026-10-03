import { redirect } from "next/navigation"

// La administración de casillas vive ahora en Mensajes (botón "Administrar casillas" junto a las
// solapas). Esta ruta provisoria de R3 solo redirige, para no romper enlaces ya compartidos.
export default function CorreoConfiguracionPage() {
  redirect("/admin/inbox")
}
