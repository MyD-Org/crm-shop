"use client";

import { useState } from "react";
import { Dialog } from "@myd-org/ui";
import { horarioParaMostrar, hoyBuenosAires } from "@/lib/horario-agrupado";
import { TEXTOS_UBICACION } from "@/lib/ubicacion";
import type { LineaDisponibilidad, LocalDisponibilidad, TonoDisponibilidad } from "@/lib/disponibilidad-textos";

const CLASE_TONO: Record<TonoDisponibilidad, string> = {
  ok: "text-success",
  demora: "text-warning",
  no: "text-danger",
};

export type LocalConEstado = { local: LocalDisponibilidad; estado: LineaDisponibilidad };

/**
 * "Ver locales" de la ficha (estilo "Ver sucursales" de las grandes tiendas): la ficha dice sólo
 * "Retiro gratis en el local" con el mejor estado, y el detalle por local vive en este popup, cada
 * uno con su estado, dirección, horario y mapa. `locales` llega ya ordenado por conveniencia.
 */
export function VerLocales({ locales }: { locales: LocalConEstado[] }) {
  const [abierto, setAbierto] = useState(false);
  // "Hoy" se calcula al abrir, en el cliente (mismo criterio que VerLocal: sin desfasaje de hidratación).
  const [hoy, setHoy] = useState("");
  const hoyDisponibles = locales.filter((l) => l.estado.tono === "ok").length;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setHoy(hoyBuenosAires());
          setAbierto(true);
        }}
        aria-haspopup="dialog"
        className="shrink-0 text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
      >
        {TEXTOS_UBICACION.verLocales}
      </button>
      <Dialog
        open={abierto}
        onOpenChange={setAbierto}
        title={TEXTOS_UBICACION.tituloLocales}
        description={hoyDisponibles > 0 ? TEXTOS_UBICACION.disponibleHoyEnLocales(hoyDisponibles) : undefined}
        size="md"
      >
        <ul className="divide-y divide-border text-sm">
          {locales.map(({ local, estado }) => {
            const direccion = [local.direccion, local.ciudad].filter(Boolean).join(", ");
            const horario = horarioParaMostrar(local, hoy).semanal;
            return (
              <li key={local.slug} className="space-y-1 py-3 first:pt-0 last:pb-0">
                <p className="font-semibold text-text">{local.nombre}</p>
                <p className={`font-semibold ${CLASE_TONO[estado.tono]}`}>{estado.texto}</p>
                {direccion && <p className="text-muted">{direccion}</p>}
                {horario && <p className="whitespace-pre-line text-muted">{horario.split(" · ").join("\n")}</p>}
                {direccion && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-accent hover:underline"
                  >
                    {TEXTOS_UBICACION.verMapa}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </Dialog>
    </>
  );
}
