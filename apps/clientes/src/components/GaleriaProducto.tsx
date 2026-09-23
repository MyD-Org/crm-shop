"use client";

import { useState } from "react";
import Image from "next/image";
import { cn } from "@myd-org/ui";
import type { ProductImage } from "@/data/products";
import { LightbulbIcon } from "@/components/catalogo/iconos";

/**
 * Galería de la ficha con las fotos del overlay del CRM (portada = [0]), ya
 * filtradas a los hosts de medios permitidos. Sin fotos, el placeholder de
 * siempre. Con más de una, miniaturas para elegir cuál se ve en grande.
 */
export function GaleriaProducto({ fotos, nombre }: { fotos?: ProductImage[]; nombre: string }) {
  const [activa, setActiva] = useState(0);
  const lista = fotos ?? [];
  const foto = lista[Math.min(activa, lista.length - 1)];

  return (
    <div className="space-y-3">
      <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-[24px] bg-elevated">
        {foto ? (
          <Image
            // La key fuerza el cambio de imagen sin arrastrar la anterior mientras carga.
            key={foto.url}
            src={foto.url}
            alt={foto.alt || nombre}
            fill
            // La galería ocupa ~5/11 del contenido desde lg; debajo, todo el ancho.
            sizes="(min-width: 1024px) 45vw, 100vw"
            className="object-contain p-6"
            // La portada es el elemento más grande de la ficha (LCP).
            preload={activa === 0}
          />
        ) : (
          <LightbulbIcon className="h-48 w-48 text-muted/20" />
        )}
      </div>

      {lista.length > 1 && (
        <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Fotos del producto">
          {lista.map((f, i) => (
            <li key={f.url} className="shrink-0">
              <button
                type="button"
                onClick={() => setActiva(i)}
                aria-label={`Ver foto ${i + 1} de ${lista.length}`}
                aria-pressed={i === activa}
                className={cn(
                  "relative block h-16 w-16 overflow-hidden rounded-xl border bg-elevated transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
                  i === activa ? "border-primary" : "border-border hover:border-muted",
                )}
              >
                <Image src={f.url} alt="" fill sizes="64px" className="object-contain p-1" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
