import { NextResponse } from "next/server";
import { horarioAgrupado } from "@/lib/horario-agrupado";
import { sucursalesCacheadas } from "@/lib/sucursales-datos";
import { sucursalesHabilitadas } from "@/lib/sucursales-flag";
import { envioPorZonaHabilitado } from "@/lib/envio-zona-flag";
import { geoFirmaConfigurada } from "@/lib/geo-token";

/**
 * Locales de retiro para el modal "Enviar a": sucursales activas que aceptan retiro, por `orden`.
 * Con el flag `sucursales` apagado no hay lista: `unico: true` (un solo "Retirar en el local", sin
 * dirección ni horario inventados). Público (no lee sesión) y con caché HTTP corto.
 * `direccionExacta`: con el envío por zona (y el secreto para firmar) el modal ofrece además la calle y
 * altura después de la localidad, para mostrar el costo exacto.
 */
export async function GET() {
  const cabeceras = { "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300" };
  const direccionExacta = geoFirmaConfigurada() && (await envioPorZonaHabilitado().catch(() => false));
  if (!(await sucursalesHabilitadas())) {
    return NextResponse.json({ locales: [], unico: true, direccionExacta }, { headers: cabeceras });
  }
  try {
    const { sucursales } = await sucursalesCacheadas();
    const locales = sucursales
      .filter((s) => s.activa && s.aceptaRetiro)
      .sort((a, b) => a.orden - b.orden || a.slug.localeCompare(b.slug))
      .map((s) => ({
        slug: s.slug,
        nombre: s.nombre,
        direccion: s.direccion,
        horario: (s.schedule && horarioAgrupado(s.schedule)) || s.horario || "",
      }));
    return NextResponse.json({ locales, unico: false, direccionExacta }, { headers: cabeceras });
  } catch (err) {
    console.error("[ubicacion] no se pudieron leer los locales de retiro:", err);
    return NextResponse.json({ locales: [], unico: false, direccionExacta }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
