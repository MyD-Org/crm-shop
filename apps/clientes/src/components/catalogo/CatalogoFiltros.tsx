"use client";

import { useId, useState } from "react";
import { Button, Card, Divider, FacetGroup, Field, Input, RangeSlider, Select, Switch } from "@myd-org/ui";
import type { Facetas } from "@/lib/catalog";
import {
  cambiosDePotencia,
  cambiosDeRango,
  rangoEfectivo,
  rangoEfectivoPotencia,
  type EstadoCatalogo,
} from "@/lib/catalogo-url";
import {
  alternarCategoria,
  fmtPesos,
  hayFiltros,
  itemsDeCaracteristicas,
  itemsDeFaceta,
  limpiarFiltros,
} from "@/lib/catalogo-vista";
import { formatMarca, formatRubro } from "@/lib/formato-rubro";
import { POSICION_MAX, POSICION_MIN, posicionAPrecio, precioAPosicion } from "@/lib/escala-precio";

type Ir = (cambios: Partial<EstadoCatalogo>) => void;

/** Valor del selector "Con stock en" que no filtra por local (no viaja en la URL). */
const TODOS_LOS_LOCALES = "todos";

/** Alterna un valor en una lista de filtros. */
const alternar = (lista: string[], valor: string, tildado: boolean) =>
  tildado ? [...lista, valor] : lista.filter((x) => x !== valor);

/**
 * Panel de filtros: categorías, marcas, características (atributos del
 * diccionario, ver catalogo-atributos.ts), precio y disponibilidad. Puro: todo
 * lo que toca el visitante sale por `ir` como cambios de estado (que el
 * padre convierte en URL). Sin `dentroDeSheet` va dentro de una `Card` con
 * "Limpiar" en el encabezado (aside de desktop); con `dentroDeSheet` se
 * renderiza pelado, para la hoja de filtros de mobile.
 */
export function CatalogoFiltros({
  facetas,
  estado,
  ir,
  dentroDeSheet = false,
}: {
  facetas: Facetas;
  estado: EstadoCatalogo;
  ir: Ir;
  dentroDeSheet?: boolean;
}) {
  // useId: el panel se monta dos veces (aside y hoja de mobile).
  const idDisponibilidad = useId();
  const grupos = (
    <div className="flex flex-col gap-5">
      <FacetGroup
        title="Categorías"
        items={itemsDeFaceta(facetas.categorias, estado.categorias).map((c) => ({
          value: c.label,
          label: formatRubro(c.label),
          // Las subcategorías van debajo de su madre, corridas un nivel.
          depth: "nivel" in c ? (c.nivel ?? 1) - 1 : 0,
          count: c.count,
          // Va siempre el árbol completo, con o sin búsqueda: las de 0 se ven con su 0,
          // sin atenuar, y se pueden tildar igual.
          checked: c.checked,
        }))}
        // Tildar una madre saca a sus hijas: la madre ya incluye toda su rama.
        onToggle={(valor, tildado) =>
          ir({ categorias: alternarCategoria(facetas.categorias, estado.categorias, valor, tildado) })
        }
        emptyText="Sin categorías para estos filtros"
      />
      <Divider />
      <FacetGroup
        title="Marcas"
        items={itemsDeFaceta(facetas.marcas, estado.marcas).map((m) => ({
          value: m.label,
          label: formatMarca(m.label),
          count: m.count,
          checked: m.checked,
        }))}
        onToggle={(valor, tildado) => ir({ marcas: alternar(estado.marcas, valor, tildado) })}
        searchable
        searchPlaceholder="Buscar marca…"
        initialVisible={6}
        moreLabel="Ver todas las marcas ({n})"
        lessLabel="Ver menos"
        emptyText="Sin marcas para estos filtros"
        searchEmptyText="No hay marcas que coincidan con su búsqueda."
      />
      {/* Sólo con algo para ofrecer: los atributos salen del nombre del
          producto y en muchas categorías (herramientas, cables) no hay
          ninguno. Uno tildado que ya no cuenta sigue apareciendo (itemsDeFaceta). */}
      {(facetas.atributos.length > 0 || estado.atributos.length > 0) && (
        <>
          <Divider />
          <FacetGroup
            title="Características"
            items={itemsDeCaracteristicas(facetas.atributos, estado.atributos)}
            onToggle={(valor, tildado) => ir({ atributos: alternar(estado.atributos, valor, tildado) })}
            emptyText="Sin características para estos filtros"
          />
        </>
      )}
      {/* Potencia (fase 2): sólo con datos estructurados (flag `busqueda-ia` y la tabla del CRM),
          y sobre los productos que tienen potencia cargada. */}
      {facetas.potencia && (
        <>
          <Divider />
          <FiltroPotencia rango={facetas.potencia} estado={estado} ir={ir} />
        </>
      )}
      {facetas.precio && (
        <>
          <Divider />
          <FiltroPrecio facetas={facetas} estado={estado} ir={ir} />
        </>
      )}
      <Divider />
      <section aria-labelledby={idDisponibilidad} className="flex flex-col gap-3">
        <h3
          id={idDisponibilidad}
          className="text-xs font-semibold uppercase tracking-wide text-muted"
        >
          Disponibilidad
        </h3>
        <Switch
          label="Solo con stock"
          checked={estado.soloStock || Boolean(estado.retiroEn)}
          // Apagarlo también quita "Con stock en <local>": sin stock no hay local que filtrar.
          onCheckedChange={(v) => ir(v ? { soloStock: true } : { soloStock: false, retiroEn: undefined })}
        />
        {facetas.locales && facetas.locales.length > 1 && (
          <Field label="Con stock en">
            <Select
              aria-label="Con stock en"
              options={[
                { value: TODOS_LOS_LOCALES, label: "Cualquier local" },
                ...facetas.locales.map((l) => ({ value: l.slug, label: l.nombre })),
              ]}
              value={estado.retiroEn ?? TODOS_LOS_LOCALES}
              onValueChange={(v) =>
                ir(v === TODOS_LOS_LOCALES ? { retiroEn: undefined } : { retiroEn: v, soloStock: true })
              }
            />
          </Field>
        )}
      </section>
    </div>
  );

  if (dentroDeSheet) return grupos;

  return (
    <Card
      title="Filtros"
      action={
        hayFiltros(estado) ? (
          <Button variant="link" size="inline" onClick={() => ir(limpiarFiltros())}>
            Limpiar
          </Button>
        ) : undefined
      }
    >
      {grupos}
    </Card>
  );
}

/** Sólo dígitos: lo que puede escribir la persona en Desde/Hasta. */
const soloDigitos = (s: string) => s.replace(/[^\d]/g, "");

/**
 * Slider de precio (escala logarítmica, ver `@/lib/escala-precio`) + dos
 * campos numéricos ("Desde" / "Hasta") sincronizados con él.
 *
 * El slider arrastra POSICIONES (0..1000), no precios: la mayoría de los
 * productos cae cerca del mínimo, y en una escala lineal ese tramo ocupa un
 * pixel. Mientras se arrastra, la posición vive acá; la navegación sale sólo
 * al soltar (`onValueCommit`). Los campos de texto, en cambio, escriben el
 * monto EXACTO (sin el redondeo "lindo" del slider) y navegan al perder foco
 * o con Enter.
 *
 * Los dos controles quedan atados a la URL y al rango vigentes: cuando
 * cualquiera de los dos cambia (llegó una página nueva) y la persona no está
 * escribiendo, vuelven a mostrar lo que dice la URL.
 */
const miles = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 0 });

function FiltroPrecio({
  facetas,
  estado,
  ir,
}: {
  facetas: Facetas;
  estado: EstadoCatalogo;
  ir: Ir;
}) {
  const idPrecio = useId();
  const rango = facetas.precio;
  const clave = `${estado.precioMin}|${estado.precioMax}|${rango?.min}|${rango?.max}`;
  const [arrastre, setArrastre] = useState<{ clave: string; posiciones: [number, number] } | null>(
    null
  );
  const [editando, setEditando] = useState<null | "desde" | "hasta">(null);
  const [textoDesde, setTextoDesde] = useState("");
  const [textoHasta, setTextoHasta] = useState("");
  if (!rango) return null;

  const [precioMin, precioMax] = rangoEfectivo(estado, rango);
  const posicionesBase: [number, number] = [
    precioAPosicion(precioMin, rango.min, rango.max),
    precioAPosicion(precioMax, rango.min, rango.max),
  ];
  const posiciones = arrastre?.clave === clave ? arrastre.posiciones : posicionesBase;
  const precios: [number, number] = [
    posicionAPrecio(posiciones[0], rango.min, rango.max),
    posicionAPrecio(posiciones[1], rango.min, rango.max),
  ];

  // Los campos de texto siguen a la posición vigente salvo mientras se los
  // está editando (patrón de React: ajustar estado durante el render, no en
  // un efecto, para no perder lo que la persona está tipeando).
  // Con separador de miles para leerlo de un vistazo; al tipear se limpia.
  if (editando !== "desde" && textoDesde !== miles(precios[0])) {
    setTextoDesde(miles(precios[0]));
  }
  if (editando !== "hasta" && textoHasta !== miles(precios[1])) {
    setTextoHasta(miles(precios[1]));
  }

  const confirmarInput = (campo: "desde" | "hasta") => {
    setEditando(null);
    const texto = campo === "desde" ? textoDesde : textoHasta;
    if (texto.trim() === "") return;
    const n = Number(soloDigitos(texto));
    if (!Number.isFinite(n)) return;
    const acotado = Math.min(Math.max(Math.trunc(n), rango.min), rango.max);
    let [min, max] = precios;
    if (campo === "desde") min = acotado;
    else max = acotado;
    if (min > max) [min, max] = [max, min];
    setArrastre(null);
    ir(cambiosDeRango([min, max], rango));
  };

  return (
    <section aria-labelledby={idPrecio} className="flex flex-col gap-3">
      <h3 id={idPrecio} className="text-xs font-semibold uppercase tracking-wide text-muted">
        Precio
      </h3>
      <RangeSlider
        min={POSICION_MIN}
        max={POSICION_MAX}
        step={1}
        value={posiciones}
        onValueChange={(v) => setArrastre({ clave, posiciones: v })}
        onValueCommit={(v) => {
          setArrastre(null);
          const precioDesde = posicionAPrecio(v[0], rango.min, rango.max);
          const precioHasta = posicionAPrecio(v[1], rango.min, rango.max);
          ir(cambiosDeRango([precioDesde, precioHasta], rango));
        }}
        formatValue={(p) => fmtPesos(posicionAPrecio(p, rango.min, rango.max))}
        thumbLabels={["Precio mínimo", "Precio máximo"]}
        disabled={rango.min === rango.max}
        aria-label="Precio"
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Desde">
          <Input
            type="text"
            inputMode="numeric"
            value={textoDesde}
            onFocus={() => setEditando("desde")}
            onChange={(e) => setTextoDesde(soloDigitos(e.target.value))}
            onBlur={() => confirmarInput("desde")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                confirmarInput("desde");
                e.currentTarget.blur();
              }
            }}
            disabled={rango.min === rango.max}
            aria-label="Precio desde"
          />
        </Field>
        <Field label="Hasta">
          <Input
            type="text"
            inputMode="numeric"
            value={textoHasta}
            onFocus={() => setEditando("hasta")}
            onChange={(e) => setTextoHasta(soloDigitos(e.target.value))}
            onBlur={() => confirmarInput("hasta")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                confirmarInput("hasta");
                e.currentTarget.blur();
              }
            }}
            disabled={rango.min === rango.max}
            aria-label="Precio hasta"
          />
        </Field>
      </div>
    </section>
  );
}

const fmtWatts = (w: number) => `${w.toLocaleString("es-AR", { maximumFractionDigits: 1 })} W`;

/**
 * Slider de potencia en watts (misma escala logarítmica que el precio: la mayoría de los
 * productos tiene pocos watts y unos pocos llegan a miles). Navega al soltar.
 */
function FiltroPotencia({
  rango,
  estado,
  ir,
}: {
  rango: NonNullable<Facetas["potencia"]>;
  estado: EstadoCatalogo;
  ir: Ir;
}) {
  const idPotencia = useId();
  const clave = `${estado.potenciaMin}|${estado.potenciaMax}|${rango.min}|${rango.max}`;
  const [arrastre, setArrastre] = useState<{ clave: string; posiciones: [number, number] } | null>(null);
  const [min, max] = rangoEfectivoPotencia(estado, rango);
  const posiciones: [number, number] =
    arrastre?.clave === clave
      ? arrastre.posiciones
      : [precioAPosicion(min, rango.min, rango.max), precioAPosicion(max, rango.min, rango.max)];
  const aWatts = (p: number) => posicionAPrecio(p, rango.min, rango.max);

  return (
    <section aria-labelledby={idPotencia} className="flex flex-col gap-3">
      <h3 id={idPotencia} className="text-xs font-semibold uppercase tracking-wide text-muted">
        Potencia
      </h3>
      <RangeSlider
        min={POSICION_MIN}
        max={POSICION_MAX}
        step={1}
        value={posiciones}
        onValueChange={(v) => setArrastre({ clave, posiciones: v })}
        onValueCommit={(v) => {
          setArrastre(null);
          ir(cambiosDePotencia([aWatts(v[0]), aWatts(v[1])], rango));
        }}
        formatValue={(p) => fmtWatts(aWatts(p))}
        thumbLabels={["Potencia mínima", "Potencia máxima"]}
        disabled={rango.min === rango.max}
        aria-label="Potencia"
      />
      <p className="text-xs text-muted">
        {fmtWatts(aWatts(posiciones[0]))} – {fmtWatts(aWatts(posiciones[1]))}
      </p>
    </section>
  );
}
