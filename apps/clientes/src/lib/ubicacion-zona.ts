import type { MetodoEnvio } from "./envio-zona";

/**
 * «Usar mi ubicación» con el envío por zona: Georef (`/ubicacion`) no devuelve localidades, sólo el
 * municipio («General Pueyrredón» en vez de «Mar del Plata»), y con eso no se encuentra la tarifa. Si el
 * punto cae en el rectángulo de una localidad que atiende un método activo de esa provincia, se usa esa
 * localidad (la más chica si hay varias). Puro; las coordenadas no se guardan.
 */
export function localidadAtendidaEn(
  metodos: MetodoEnvio[] | undefined,
  provinciaClave: string,
  lat: number,
  lon: number,
): { localidad: string; id: string } | null {
  let mejor: { localidad: string; id: string; area: number } | null = null;
  for (const m of metodos ?? []) {
    if (!m.activo || m.provinciaClave !== provinciaClave) continue;
    for (const l of m.localidades ?? []) {
      const b = l.bbox;
      if (!b || lat < b.sur || lat > b.norte || lon < b.oeste || lon > b.este) continue;
      const nombre = (l.etiqueta ?? "").split(" — ")[0]?.trim();
      if (!nombre) continue;
      const area = (b.norte - b.sur) * (b.este - b.oeste);
      if (!mejor || area < mejor.area) mejor = { localidad: nombre, id: l.georefId, area };
    }
  }
  return mejor && { localidad: mejor.localidad, id: mejor.id };
}
