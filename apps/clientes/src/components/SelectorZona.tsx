"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { COOKIE_ZONA, COOKIE_ZONA_MAX_AGE } from "@/lib/zona";

/**
 * Zona vigente del visitante, discreta y cambiable (catálogo, con el flag `sucursales`
 * prendido). Elegir una provincia guarda la cookie `shop_zona` con la clave de esa provincia y
 * pide la página de nuevo. Vaciar la elección borra la cookie y vuelve la sucursal predeterminada.
 * No cambia qué productos se ven: sólo qué sucursal atiende.
 */
export function SelectorZona({
  provincias,
  actual,
  sucursal,
}: {
  provincias: { clave: string; nombre: string }[];
  /** Clave de la provincia elegida (cookie o perfil); null = ninguna. */
  actual: string | null;
  /** Nombre de la sucursal que atiende la zona vigente. */
  sucursal: string | null;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();

  const elegir = (clave: string) => {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = clave
      ? `${COOKIE_ZONA}=${clave}; Path=/; Max-Age=${COOKIE_ZONA_MAX_AGE}; SameSite=Lax${secure}`
      : `${COOKIE_ZONA}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
    startTransition(() => router.refresh());
  };

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted"
      aria-busy={pendiente}
    >
      {sucursal ? (
        <span>
          Sucursal de su zona: <span className="text-text">{sucursal}</span>
        </span>
      ) : null}
      <label className="flex items-center gap-2">
        <span>Provincia</span>
        <select
          className="rounded-md border border-border bg-surface px-2 py-1 text-text"
          value={actual ?? ""}
          onChange={(e) => elegir(e.target.value)}
          disabled={pendiente}
        >
          <option value="">Seleccione su provincia</option>
          {provincias.map((p) => (
            <option key={p.clave} value={p.clave}>
              {p.nombre}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
