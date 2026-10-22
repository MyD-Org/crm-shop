"use client";

import { useEffect, useState } from "react";
import { Field, Input, Select, Switch } from "@myd-org/ui";
import type { NavBadgeContent } from "@/data/home-defaults";
import { formatRubro } from "@/lib/formato-rubro";
import { MAX_CATEGORIAS_NAV, normalizarCategoria } from "@/lib/nav-badge";
import type { EditorProps } from "./index";

const DEFAULT_BADGE: NavBadgeContent = { categoria: "ILUMINACION", texto: "Nuevo" };

/**
 * `valor === null` ⇒ badge apagado (Switch "Sin badge" prendido). El Switch
 * prendido manda `onChange(null)`; al apagarlo se recupera el último valor
 * conocido (o el default) para volver a editar categoría/texto.
 *
 * La categoría se elige de un desplegable con las categorías del menú, no se
 * escribe: con texto libre sólo funcionaba escribiéndola igual que en el
 * catálogo ("ILUMINACION"), y cualquier otra forma —la que se ve en el menú—
 * se guardaba sin error y el badge no aparecía. Las opciones son las mismas
 * que muestra el header (`/api/shop/categorias`, primeras
 * `MAX_CATEGORIAS_NAV`), así que no se puede elegir una que no esté.
 */
export function EditorNavBadge({ valor, onChange }: EditorProps<NavBadgeContent | null>) {
  const [ultimo, setUltimo] = useState<NavBadgeContent>(valor ?? DEFAULT_BADGE);
  const [categorias, setCategorias] = useState<string[] | null>(null);
  const [errorCategorias, setErrorCategorias] = useState(false);

  useEffect(() => {
    let vigente = true;
    fetch("/api/shop/categorias")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { categorias: string[] }) => {
        if (vigente) setCategorias(d.categorias.slice(0, MAX_CATEGORIAS_NAV));
      })
      .catch(() => {
        if (vigente) setErrorCategorias(true);
      });
    return () => {
      vigente = false;
    };
  }, []);

  // Lo guardado puede estar escrito como se ve ("Seguridad"): se muestra
  // seleccionada la opción equivalente, y al guardar queda con el valor real.
  const seleccionada =
    valor && categorias
      ? categorias.find((c) => normalizarCategoria(c) === normalizarCategoria(valor.categoria))
      : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Switch
        label="Sin badge"
        checked={valor === null}
        onCheckedChange={(sinBadge) => {
          if (sinBadge) {
            if (valor) setUltimo(valor);
            onChange(null);
          } else {
            onChange(ultimo);
          }
        }}
      />
      {valor !== null ? (
        <>
          <Field
            label="Categoría"
            hint={
              errorCategorias
                ? "No se pudieron cargar las categorías. Cierre y vuelva a abrir para reintentar."
                : "La categoría del menú donde aparece el badge"
            }
          >
            <Select
              options={(categorias ?? []).map((c) => ({ value: c, label: formatRubro(c) }))}
              value={seleccionada}
              onValueChange={(c) => onChange({ ...valor, categoria: c })}
              placeholder={categorias ? "Seleccione una categoría" : "Cargando categorías…"}
              disabled={!categorias}
              aria-label="Categoría del badge"
            />
          </Field>
          <Field label="Texto">
            <Input value={valor.texto} onChange={(e) => onChange({ ...valor, texto: e.target.value })} />
          </Field>
        </>
      ) : null}
    </div>
  );
}
