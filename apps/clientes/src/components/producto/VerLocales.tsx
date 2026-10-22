"use client";

import { useState } from "react";
import { Badge, Button, Dialog, type BadgeTone } from "@myd-org/ui";
import { enlaceWhatsapp } from "@/lib/contacto-pedido";
import { horarioParaMostrar, hoyBuenosAires } from "@/lib/horario-agrupado";
import { TEXTOS_UBICACION } from "@/lib/ubicacion";
import type { LineaDisponibilidad, LocalDisponibilidad, TonoDisponibilidad } from "@/lib/disponibilidad-textos";

const TONO_BADGE: Record<TonoDisponibilidad, BadgeTone> = { ok: "success", demora: "warning", no: "danger" };

export type LocalConEstado = { local: LocalDisponibilidad; estado: LineaDisponibilidad };

/** "Lunes a viernes 7:45 a 12:00" → ["Lunes a viernes", "7:45 a 12:00"]; sin horas, la línea entera. */
export function partirLineaHorario(linea: string): [string, string] | [string] {
  const m = linea.match(/^(.*?\D)\s+(\d{1,2}(?::\d{2})?\s.*|cerrado.*)$/i);
  return m ? [m[1], m[2]] : [linea];
}

function IconoUbicacion() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-7-5.6-7-11a7 7 0 0 1 14 0c0 5.4-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function IconoReloj() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

const enlaceExterno = ({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) => (
  <a href={href} className={className} target="_blank" rel="noopener noreferrer">
    {children}
  </a>
);

function Local({ local, estado, hoy }: LocalConEstado & { hoy: string }) {
  const direccion = [local.direccion, local.ciudad].filter(Boolean).join(", ");
  const horario = horarioParaMostrar(local, hoy).semanal;
  const lineas = horario ? horario.split(" · ").map(partirLineaHorario) : [];
  const whatsapp = enlaceWhatsapp(local.whatsapp);

  return (
    <li className="py-5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <h3 className="text-base font-semibold text-text">{local.nombre}</h3>
        <Badge tone={TONO_BADGE[estado.tono]}>{estado.texto}</Badge>
      </div>

      <div className="mt-3 space-y-2.5 text-sm">
        {direccion && (
          <p className="grid grid-cols-[16px_minmax(0,1fr)] gap-2.5 text-text">
            <span className="mt-0.5 text-muted">
              <IconoUbicacion />
            </span>
            {direccion}
          </p>
        )}
        {lineas.length > 0 && (
          <div className="grid grid-cols-[16px_minmax(0,1fr)] gap-2.5">
            <span className="mt-0.5 text-muted">
              <IconoReloj />
            </span>
            <dl className="grid grid-cols-1 gap-x-4 tabular-nums sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-y-1">
              {lineas.map((l, i) =>
                l.length === 2 ? (
                  <div key={i} className="contents">
                    <dt className={`text-muted ${i > 0 ? "mt-1.5 sm:mt-0" : ""}`}>{l[0]}</dt>
                    <dd className="text-text">{l[1]}</dd>
                  </div>
                ) : (
                  <dd key={i} className="col-span-2 text-text">
                    {l[0]}
                  </dd>
                ),
              )}
            </dl>
          </div>
        )}
      </div>

      {(direccion || whatsapp) && (
        <div className="mt-4 flex flex-wrap gap-2 sm:pl-[26px]">
          {direccion && (
            <Button
              variant="outline"
              size="sm"
              href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(direccion)}`}
              renderLink={enlaceExterno}
            >
              {TEXTOS_UBICACION.comoLlegar}
            </Button>
          )}
          {whatsapp && (
            <Button variant="ghost" size="sm" href={whatsapp} renderLink={enlaceExterno}>
              {TEXTOS_UBICACION.escribirWhatsapp}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * "Ver locales" de la ficha (estilo "Ver sucursales" de las grandes tiendas): la ficha dice sólo
 * "Retiro gratis en el local" con el mejor estado, y el detalle por local vive en este popup, cada
 * uno con su estado, dirección, horario y cómo llegar. `locales` llega ya ordenado por conveniencia.
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
        <ul className="divide-y divide-border">
          {locales.map((l) => (
            <Local key={l.local.slug} {...l} hoy={hoy} />
          ))}
        </ul>
      </Dialog>
    </>
  );
}
