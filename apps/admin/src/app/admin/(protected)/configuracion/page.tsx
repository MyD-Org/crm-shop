import { redirect } from "next/navigation"

// Configuración dejó de existir como sección: sus pestañas pasaron a entradas propias del menú
// (Sucursales, Pagos y cuotas, Horarios) y el mail de avisos vive en Comprobantes → Ajustes.
// La ruta queda sólo para que los links viejos (mails, favoritos) no den 404.
export default function ConfiguracionPage() {
  redirect("/admin/horarios")
}
