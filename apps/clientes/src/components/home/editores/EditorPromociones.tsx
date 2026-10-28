"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Field, Input, Select, Textarea } from "@myd-org/ui";
import type { EstrellaPromo, ItemPromo, PromocionesContent, Referencia } from "@/data/home-defaults";
import { campaniasParaPromo, productosParaPromo, sucursalesParaPromo, type ProductoPromoEditor } from "@/lib/home-acciones";
import type { CampaniaShop } from "@/lib/campanias/vigentes";
import { fmtPrecioCorto } from "@/lib/format";
import {
  aIsoArgentina,
  deIsoArgentina,
  descuentoPropio,
  ETIQUETAS_REFERENCIA_SUGERIDAS,
  MAX_ITEMS_PROMO,
  MAX_REFERENCIAS,
} from "@/lib/promociones/promo";
import type { SucursalPromo } from "@/lib/promociones/stock";
import { CamposTitulo } from "./CamposTitulo";
import { SelectorSkusDestacados } from "./SelectorSkusDestacados";
import { aplicarUnidades, cambiarEstrella, completarHabituales, enteroPesos, necesitaStockBase } from "./promociones-editor";
import type { EditorProps } from "./index";

const clave = (sku: string) => sku.trim().toUpperCase();
/** Valor del selector para "sin campaña" (el Select del DS no admite el valor vacío). */
const SIN_CAMPANIA = "ninguna";

/** Precio de hoy y descuento contra el habitual: confirma si el ajuste de promo del CRM ya está cargado. */
export function ResumenPrecio({ precio, esTransferencia, habitual }: { precio: number; esTransferencia: boolean; habitual?: number }) {
  const d = descuentoPropio(precio, habitual);
  return (
    <p className="text-xs text-muted">
      Hoy: {fmtPrecioCorto(precio)} {esTransferencia ? "por transferencia" : "de lista"}
      {d ? (
        <span className="ml-2 font-semibold text-success">{d.pct} % de descuento</span>
      ) : habitual ? (
        <span className="ml-2">· Todavía sin descuento: cargue el ajuste en Precios online del CRM.</span>
      ) : null}
    </p>
  );
}

const LISTA_SUGERENCIAS = "promo-referencias-sugeridas";

/** Precio habitual (el que se tacha) y hasta 3 referencias de otros canales para la escalera. */
function CamposPrecios({
  item,
  onChange,
  conHabitual = true,
}: {
  item: ItemPromo;
  onChange: (cambios: Partial<ItemPromo>) => void;
  /** false = la sección está asociada a una campaña de precios: el habitual sale de la campaña. */
  conHabitual?: boolean;
}) {
  const refs = item.referencias ?? [];
  const setRef = (n: number, cambios: Partial<Referencia>) =>
    onChange({ referencias: refs.map((r, i) => (i === n ? { ...r, ...cambios } : r)) });
  return (
    <div className="flex flex-col gap-3">
      {conHabitual ? (
        <Field label="Precio habitual por transferencia (con IVA)" hint="Es el que se tacha. Se completa solo con el precio de hoy al agregar el producto.">
          <Input inputMode="numeric" value={item.precioHabitual ? String(item.precioHabitual) : ""} onChange={(e) => onChange({ precioHabitual: enteroPesos(e.target.value) })} />
        </Field>
      ) : null}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Precios en otros canales (para la comparación)</p>
        {refs.map((r, n) => (
          <div key={n} className="grid grid-cols-[1fr_140px_auto] items-end gap-2">
            <Field label={n === 0 ? "Dónde" : undefined}>
              <Input list={LISTA_SUGERENCIAS} value={r.etiqueta} onChange={(e) => setRef(n, { etiqueta: e.target.value })} placeholder="Tiendas online" />
            </Field>
            <Field label={n === 0 ? "Precio (con IVA)" : undefined}>
              <Input inputMode="numeric" value={r.precio ? String(r.precio) : ""} onChange={(e) => setRef(n, { precio: enteroPesos(e.target.value) ?? 0 })} placeholder="165000" />
            </Field>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange({ referencias: refs.filter((_, i) => i !== n).length ? refs.filter((_, i) => i !== n) : undefined })}
            >
              Quitar
            </Button>
          </div>
        ))}
        {refs.length < MAX_REFERENCIAS ? (
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            onClick={() => onChange({ referencias: [...refs, { etiqueta: ETIQUETAS_REFERENCIA_SUGERIDAS[refs.length] ?? "", precio: 0 }] })}
          >
            Agregar precio de otro canal
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Sección "Promociones" de la home: textos, vigencia, producto estrella (video, referencia,
 * unidades a precio de apertura y sucursal del contador), hasta 6 ofertas y legales.
 */
export function EditorPromociones({ valor, onChange }: EditorProps<PromocionesContent>) {
  const [sucursales, setSucursales] = useState<SucursalPromo[]>([]);
  const [campanias, setCampanias] = useState<CampaniaShop[]>([]);
  // Asociada a una campaña de precios: fechas, habitual y unidades salen de la campaña.
  const conCampania = Boolean(valor.campaniaId);
  const [productos, setProductos] = useState<Record<string, ProductoPromoEditor>>({});
  // Sucursal de la que se leyó el stock de `productos`: el stock base sólo se toma de la vigente.
  const [productosEn, setProductosEn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const estrellaAnterior = useRef<EstrellaPromo | undefined>(valor.estrella);
  const e = valor.estrella;
  const sucursal = e?.sucursal ?? sucursales.find((s) => s.predeterminada)?.slug ?? "";
  const skus = [e?.sku, ...valor.items.map((i) => i.sku)].filter((s): s is string => !!s);
  const skusClave = skus.map(clave).join("\n");

  useEffect(() => {
    let vigente = true;
    sucursalesParaPromo().then((s) => vigente && setSucursales(s), () => {});
    campaniasParaPromo().then((c) => vigente && setCampanias(c), () => {});
    return () => {
      vigente = false;
    };
  }, []);

  // Precio y stock de los productos elegidos (en la sucursal del contador).
  useEffect(() => {
    if (!skusClave || !sucursal) return;
    let vigente = true;
    productosParaPromo(skusClave.split("\n"), sucursal).then(
      (r) => {
        if (!vigente) return;
        if (!r.ok) return setError(r.errores[0] ?? null);
        setProductos(Object.fromEntries(r.productos.map((p) => [clave(p.sku), p])));
        setProductosEn(sucursal);
      },
      () => vigente && setError("No se pudieron leer los productos. Inténtelo de nuevo."),
    );
    return () => {
      vigente = false;
    };
  }, [skusClave, sucursal]);

  // El precio habitual (el que se tacha) se completa con el precio de hoy al agregar el producto.
  // Con campaña de precios no: el habitual sale de la campaña.
  useEffect(() => {
    if (conCampania) return;
    const precios = Object.fromEntries(Object.entries(productos).map(([k, p]) => [k, p.precio]));
    const completo = completarHabituales(valor, precios);
    if (completo !== valor) onChange(completo);
  }, [productos, valor, onChange, conCampania]);

  // Al cambiar estrella, sucursal o unidades se vuelve a tomar el stock base del contador.
  useEffect(() => {
    if (productosEn !== sucursal) return;
    const antes = estrellaAnterior.current;
    estrellaAnterior.current = e;
    const conSucursal = e && { ...e, sucursal: e.sucursal ?? sucursal };
    if (!e || !necesitaStockBase(antes && { ...antes, sucursal: antes.sucursal ?? sucursal }, conSucursal)) return;
    const p = productos[clave(e.sku)];
    if (!p) return;
    onChange(aplicarUnidades(valor, { unidades: e.unidadesPromo, stock: p.stock, sucursal }));
  }, [e, productos, productosEn, sucursal, valor, onChange]);

  const setEstrella = (cambios: Partial<EstrellaPromo> | null) => {
    if (cambios === null) return onChange({ ...valor, estrella: undefined });
    onChange({ ...valor, estrella: cambiarEstrella(e, cambios) });
  };
  const setItem = (n: number, cambios: Partial<ItemPromo>) =>
    onChange({ ...valor, items: valor.items.map((it, i) => (i === n ? { ...it, ...cambios } : it)) });
  const resumen = (sku: string, habitual?: number) => {
    const p = productos[clave(sku)];
    return p ? <ResumenPrecio precio={p.precio} esTransferencia={p.esTransferencia} habitual={habitual} /> : null;
  };

  return (
    <div className="flex flex-col gap-5">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <CamposTitulo valor={valor} onChange={onChange} conEyebrow />

      <Field
        label="Campaña de precios"
        hint="Con una campaña, las fechas, el precio que se tacha y las unidades de la estrella salen de la campaña (Catálogo › Campañas del CRM)."
      >
        <Select
          options={[
            { value: SIN_CAMPANIA, label: "Ninguna: fechas y precios cargados a mano" },
            ...campanias.map((c) => ({ value: c.id, label: c.nombre })),
            // Una campaña guardada que ya no está en la lista (terminada hace más de 24 h).
            ...(valor.campaniaId && !campanias.some((c) => c.id === valor.campaniaId)
              ? [{ value: valor.campaniaId, label: "Campaña terminada" }]
              : []),
          ]}
          value={valor.campaniaId ?? SIN_CAMPANIA}
          onValueChange={(v) => onChange({ ...valor, campaniaId: v === SIN_CAMPANIA ? undefined : v })}
          aria-label="Campaña de precios"
        />
      </Field>

      {conCampania ? (
        <Alert tone="neutral">
          Las fechas, el precio habitual que se tacha y las unidades de la estrella salen de la campaña de precios.
        </Alert>
      ) : (
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Empieza" hint="Hora de Argentina. Vacío: ya empezó.">
          <Input
            type="datetime-local"
            value={valor.inicio ? deIsoArgentina(valor.inicio) : ""}
            onChange={(ev) => onChange({ ...valor, inicio: ev.target.value ? aIsoArgentina(ev.target.value) : undefined })}
          />
        </Field>
        <Field label="Termina" hint="Hora de Argentina. A esa hora la promo deja de verse.">
          <Input
            type="datetime-local"
            value={valor.fin ? deIsoArgentina(valor.fin) : ""}
            onChange={(ev) => onChange({ ...valor, fin: ev.target.value ? aIsoArgentina(ev.target.value) : undefined })}
          />
        </Field>
      </div>
      )}

      <fieldset className="flex flex-col gap-3 rounded-lg border border-black/10 p-4">
        <legend className="px-1 text-sm font-semibold">Producto estrella</legend>
        <SelectorSkusDestacados skus={e?.sku ? [e.sku] : []} onChange={(s) => (s[0] ? setEstrella({ sku: s.at(-1)! }) : setEstrella(null))} />
        {e?.sku ? (
          <>
            {resumen(e.sku, e.precioHabitual)}
            <CamposPrecios item={e} onChange={(cambios) => setEstrella(cambios)} conHabitual={!conCampania} />
            <Field label="Video (YouTube o Vimeo)" hint="Un Short no listado sirve. Vacío: la foto del producto.">
              <Input value={e.video ?? ""} onChange={(ev) => setEstrella({ video: ev.target.value.trim() || undefined })} placeholder="https://www.youtube.com/shorts/…" />
            </Field>
            {conCampania ? null : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Unidades a precio de apertura" hint="Vacío: sin contador.">
                <Input inputMode="numeric" value={e.unidadesPromo ? String(e.unidadesPromo) : ""} onChange={(ev) => setEstrella({ unidadesPromo: enteroPesos(ev.target.value) })} />
              </Field>
              <Field label="Sucursal que cuenta las unidades">
                <Select
                  options={sucursales.map((s) => ({ value: s.slug, label: s.nombre }))}
                  value={sucursal}
                  onValueChange={(v) => setEstrella({ sucursal: v })}
                  aria-label="Sucursal que cuenta las unidades"
                />
              </Field>
            </div>
            )}
            {!conCampania && e.unidadesPromo && productos[clave(e.sku)] ? (
              <p className="text-xs text-muted">
                Stock actual en la sucursal: {productos[clave(e.sku)].stock ?? "sin control de stock"}.
              </p>
            ) : null}
            <Field label="Título de la tarjeta" hint="Vacío: el nombre del producto.">
              <Input value={e.titulo ?? ""} onChange={(ev) => setEstrella({ titulo: ev.target.value || undefined })} />
            </Field>
            <Field label="Bajada de la tarjeta">
              <Textarea value={e.bajada ?? ""} onChange={(ev) => setEstrella({ bajada: ev.target.value || undefined })} />
            </Field>
          </>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-lg border border-black/10 p-4">
        <legend className="px-1 text-sm font-semibold">Otras ofertas (hasta {MAX_ITEMS_PROMO})</legend>
        <SelectorSkusDestacados
          skus={valor.items.map((i) => i.sku)}
          onChange={(s) =>
            onChange({
              ...valor,
              items: s.slice(0, MAX_ITEMS_PROMO).map((sku) => valor.items.find((i) => clave(i.sku) === clave(sku)) ?? { sku }),
            })
          }
        />
        {valor.items.map((it, n) => (
          <div key={it.sku} className="flex flex-col gap-1 border-t border-black/5 pt-3">
            <p className="text-sm font-medium">{productos[clave(it.sku)]?.nombre ?? it.sku}</p>
            {resumen(it.sku, it.precioHabitual)}
            <CamposPrecios item={it} onChange={(cambios) => setItem(n, cambios)} conHabitual={!conCampania} />
          </div>
        ))}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Etiqueta de las ofertas" hint="Ej.: «Precio de lanzamiento». También arma «¡Últimas 5 unidades a precio de lanzamiento!».">
          <Input value={valor.etiquetaBadge} onChange={(ev) => onChange({ ...valor, etiquetaBadge: ev.target.value })} />
        </Field>
        <Field label="Título de la comparación (opcional)" hint="Va sobre la escalera de precios de la estrella y de la ficha. Vacío: sin título.">
          <Input value={valor.tituloComparador ?? ""} onChange={(ev) => onChange({ ...valor, tituloComparador: ev.target.value.trim() ? ev.target.value : undefined })} />
        </Field>
      </div>
      <datalist id={LISTA_SUGERENCIAS}>
        {ETIQUETAS_REFERENCIA_SUGERIDAS.map((e) => (
          <option key={e} value={e} />
        ))}
      </datalist>
      <Field label="Legales" hint="Use {inicio}, {fin} y {unidades}: se reemplazan solos.">
        <Textarea value={valor.legales ?? ""} onChange={(ev) => onChange({ ...valor, legales: ev.target.value || undefined })} />
      </Field>
      <Field label="Enlace de 'Ver todas'" hint="Ruta interna (por ejemplo /catalogo). Vacío: no se muestra.">
        <Input value={valor.linkTodos ?? ""} onChange={(ev) => onChange({ ...valor, linkTodos: ev.target.value.trim() || undefined })} />
      </Field>
    </div>
  );
}
