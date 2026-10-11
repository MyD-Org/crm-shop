export const ETIQUETA_ESTADO: Record<string, string> = {
  esperando_material: "Esperando material",
  borrador: "Borrador",
  renderizando: "Generando",
  para_revisar: "Para revisar",
  cambios_pedidos: "Cambios pedidos",
  aprobada: "Aprobada",
  programada: "Programada",
  publicada: "Publicada",
  fallida: "Falló la publicación",
  descartada: "Descartada",
}
export const TONO_ESTADO: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  esperando_material: "warning",
  borrador: "neutral",
  renderizando: "info",
  para_revisar: "info",
  cambios_pedidos: "warning",
  aprobada: "success",
  programada: "success",
  publicada: "success",
  fallida: "danger",
  descartada: "neutral",
}
export const ETIQUETA_FORMATO: Record<string, string> = {
  reel: "Reel",
  carrusel: "Carrusel",
  story: "Story",
  post: "Post",
  novedad_google: "Novedad de Google",
}
export const ETIQUETA_PUBLICO: Record<string, string> = { profesional: "Profesionales", consumidor: "Consumidor final", ambos: "Ambos" }
