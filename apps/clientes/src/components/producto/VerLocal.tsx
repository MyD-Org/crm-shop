"use client";

import { useState } from "react";
import { Dialog } from "@myd-org/ui";
import { enlaceWhatsapp } from "@/lib/contacto-pedido";
import { horarioParaMostrar, hoyBuenosAires } from "@/lib/horario-agrupado";
import type { EstadoProductoLocal, LocalDisponibilidad, TonoDisponibilidad } from "@/lib/disponibilidad-textos";

const CLASE_TONO: Record<TonoDisponibilidad, string> = {
  ok: "text-success",
  demora: "text-warning",
  no: "text-danger",
};

const MARCA: Record<TonoDisponibilidad, string> = { ok: "✓", demora: "•", no: "✕" };

/**
 * "Ver local": popup con dirección, horario, WhatsApp y mapa del local (embed de Google Maps sin
 * clave). En el carrito suma cómo está cada producto del pedido en ese local.
 */
export function VerLocal({ local, productos }: { local: LocalDisponibilidad; productos?: EstadoProductoLocal[] }) {
  const [abierto, setAbierto] = useState(false);
  // "Hoy" se calcula al abrir (en el cliente, con fecha de Buenos Aires): ni en el render del
  // servidor ni en una caché, así no hay desfasaje de hidratación ni excepciones vencidas.
  const [hoy, setHoy] = useState("");
  const horario = horarioParaMostrar(local, hoy);
  const direccion = [local.direccion, local.ciudad].filter(Boolean).join(", ");
  const whatsapp = enlaceWhatsapp(local.whatsapp);
  const consulta = encodeURIComponent(direccion);

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
        Ver local
      </button>
      <Dialog open={abierto} onOpenChange={setAbierto} title={local.nombre} description={direccion || undefined} size="md">
        <div className="space-y-4 text-sm">
          {direccion && (
            <div className="overflow-hidden rounded-md border border-border">
              <iframe
                title={`Mapa de ${local.nombre}`}
                src={`https://www.google.com/maps?q=${consulta}&output=embed`}
                className="block h-56 w-full"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          )}
          <dl className="space-y-2">
            {horario.semanal && (
              <div>
                <dt className="font-semibold text-text">Horario</dt>
                <dd className="whitespace-pre-line text-muted">{horario.semanal.split(" · ").join("\n")}</dd>
              </div>
            )}
            {horario.excepciones.length > 0 && (
              <div>
                <dt className="font-semibold text-text">Próximos cambios</dt>
                <dd>
                  <ul className="text-muted">
                    {horario.excepciones.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            {whatsapp && (
              <div>
                <dt className="font-semibold text-text">WhatsApp</dt>
                <dd>
                  <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    {local.whatsapp}
                  </a>
                </dd>
              </div>
            )}
          </dl>
          {productos && productos.length > 0 && (
            <div>
              <p className="font-semibold text-text">Su pedido en este local</p>
              <ul className="mt-1.5 space-y-1">
                {productos.map((p, i) => (
                  <li key={`${p.nombre}-${i}`} className="flex gap-2">
                    <span aria-hidden className={CLASE_TONO[p.estado.tono]}>
                      {MARCA[p.estado.tono]}
                    </span>
                    <span>
                      <span className="text-text">{p.nombre}</span>
                      {" · "}
                      <span className={CLASE_TONO[p.estado.tono]}>
                        {p.estado.tono === "no" ? "No está en este local" : p.estado.texto}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {direccion && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${consulta}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block font-semibold text-accent hover:underline"
            >
              Cómo llegar
            </a>
          )}
        </div>
      </Dialog>
    </>
  );
}
