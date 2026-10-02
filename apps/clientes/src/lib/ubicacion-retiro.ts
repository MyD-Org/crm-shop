/**
 * Validación del retiro en local contra las sucursales vigentes. SOLO servidor. La comparten la
 * lectura de la cookie (`ubicacion-servidor`) y la API que la escribe (`/api/ubicacion`), para que
 * una elección que se escribe sea siempre una que después se lee.
 */
import { sucursalesCacheadas } from "./sucursales-datos";
import { sucursalesHabilitadas } from "./sucursales-flag";
import type { EleccionUbicacion } from "./ubicacion";

export type RetiroResuelto = Extract<EleccionUbicacion, { tipo: "retiro" }>;

/**
 * Retiro validado contra las sucursales vigentes; null si no vale. Con el flag `sucursales` apagado
 * sólo es válido sin slug (local único); encendido exige una sucursal activa que acepte retiro.
 */
export async function retiroValido(cruda: { sucursal?: string }): Promise<RetiroResuelto | null> {
  try {
    if (!(await sucursalesHabilitadas())) {
      // Sin sucursales el único retiro posible es el local único de la empresa (sin slug).
      return cruda.sucursal ? null : { tipo: "retiro", sucursal: null };
    }
    if (!cruda.sucursal) return null;
    // `sucursalesCacheadas` directo: `localesDeRetiro()` depende del flag disponibilidad-sucursal.
    const { sucursales } = await sucursalesCacheadas();
    const s = sucursales.find((x) => x.slug === cruda.sucursal && x.activa && x.aceptaRetiro);
    if (!s) return null;
    return {
      tipo: "retiro",
      sucursal: { slug: s.slug, nombre: s.nombre, ciudad: s.ciudad, provincia: s.provincia },
    };
  } catch (err) {
    console.error("[ubicacion] no se pudieron leer las sucursales:", err);
    return null;
  }
}
