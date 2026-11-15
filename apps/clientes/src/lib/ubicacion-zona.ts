import { cotizarMetodo, type MetodoEnvio } from "./envio-zona";

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

/** Nombre de la zona que resuelve el punto con las mismas reglas que el pedido; null = ninguna. Puro. */
export function zonaDelPunto(
  metodos: MetodoEnvio[],
  provinciaClave: string,
  localidad: string,
  cp: string,
  lat: number,
  lon: number,
  precision: "altura" | "calle",
): string | null {
  const ordenados = [...metodos].filter((m) => m.activo).sort((a, b) => a.orden - b.orden);
  for (const m of ordenados) {
    const r = cotizarMetodo(
      m,
      { provinciaClave, localidad, cp: cp || null, punto: { lat, lon, precision } },
      { origen: null, subtotalSinIva: 0, gratisTienda: false, gratisCupon: false },
    );
    if (r) return r.zona;
  }
  return null;
}
