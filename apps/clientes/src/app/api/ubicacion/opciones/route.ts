import { NextResponse } from "next/server";
import { horarioAgrupado } from "@/lib/horario-agrupado";
import { sucursalesCacheadas } from "@/lib/sucursales-datos";
import { sucursalesHabilitadas } from "@/lib/sucursales-flag";

/**
 * Locales de retiro para el modal "Enviar a": sucursales activas que aceptan retiro, por `orden`.
 * Con el flag `sucursales` apagado no hay lista: `unico: true` (un solo "Retirar en el local", sin
 * dirección ni horario inventados). Público (no lee sesión) y con caché HTTP corto.
 */
export async function GET() {
  const cabeceras = { "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300" };
  if (!(await sucursalesHabilitadas())) {
    return NextResponse.json({ locales: [], unico: true }, { headers: cabeceras });
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
    return NextResponse.json({ locales, unico: false }, { headers: cabeceras });
  } catch (err) {
    console.error("[ubicacion] no se pudieron leer los locales de retiro:", err);
    return NextResponse.json({ locales: [], unico: false }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
