"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Field, Input, Select, Textarea } from "@myd-org/ui";
import type { EstrellaPromo, ItemPromo, PromocionesContent } from "@/data/home-defaults";
import { productosParaPromo, sucursalesParaPromo, type ProductoPromoEditor } from "@/lib/home-acciones";
import { fmtPrecioCorto } from "@/lib/format";
import { aIsoArgentina, deIsoArgentina, MAX_ITEMS_PROMO, porcentajeAhorro } from "@/lib/promociones/promo";
import type { SucursalPromo } from "@/lib/promociones/stock";
import { CamposTitulo } from "./CamposTitulo";
import { SelectorSkusDestacados } from "./SelectorSkusDestacados";
import { aplicarUnidades, cambiarEstrella, enteroPesos, necesitaStockBase } from "./promociones-editor";
import type { EditorProps } from "./index";

const clave = (sku: string) => sku.trim().toUpperCase();

/** Precio actual del producto y ahorro contra la referencia: para ver si ya se cargó el ajuste en el CRM. */
export function ResumenPrecio({ precio, esTransferencia, referencia }: { precio: number; esTransferencia: boolean; referencia?: number }) {
  const pct = porcentajeAhorro(precio, referencia);
  return (
    <p className="text-xs text-muted">
      Hoy: {fmtPrecioCorto(precio)} {esTransferencia ? "por transferencia" : "de lista"}
      {pct ? <span className="ml-2 font-semibold text-danger">−{pct} %</span> : null}
    </p>
  );
}

function CampoReferencia({ valor, onChange }: { valor?: number; onChange: (v: number | undefined) => void }) {
  return (
    <Field label="Precio en otras tiendas (con IVA)" hint="Vacío: sin línea de referencia ni porcentaje de ahorro.">
      <Input inputMode="numeric" value={valor ? String(valor) : ""} onChange={(e) => onChange(enteroPesos(e.target.value))} placeholder="150000" />
    </Field>
  );
}

/**
 * Sección "Promociones" de la home: textos, vigencia, producto estrella (video, referencia,
 * unidades a precio de apertura y sucursal del contador), hasta 6 ofertas y legales.
 */
export function EditorPromociones({ valor, onChange }: EditorProps<PromocionesContent>) {
  const [sucursales, setSucursales] = useState<SucursalPromo[]>([]);
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
  const resumen = (sku: string, referencia?: number) => {
    const p = productos[clave(sku)];
    return p ? <ResumenPrecio precio={p.precio} esTransferencia={p.esTransferencia} referencia={referencia} /> : null;
  };

  return (
    <div className="flex flex-col gap-5">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <CamposTitulo valor={valor} onChange={onChange} conEyebrow />

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

      <fieldset className="flex flex-col gap-3 rounded-lg border border-black/10 p-4">
        <legend className="px-1 text-sm font-semibold">Producto estrella</legend>
        <SelectorSkusDestacados skus={e?.sku ? [e.sku] : []} onChange={(s) => (s[0] ? setEstrella({ sku: s.at(-1)! }) : setEstrella(null))} />
        {e?.sku ? (
          <>
            {resumen(e.sku, e.precioReferencia)}
            <CampoReferencia valor={e.precioReferencia} onChange={(precioReferencia) => setEstrella({ precioReferencia })} />
            <Field label="Video (YouTube o Vimeo)" hint="Un Short no listado sirve. Vacío: la foto del producto.">
              <Input value={e.video ?? ""} onChange={(ev) => setEstrella({ video: ev.target.value.trim() || undefined })} placeholder="https://www.youtube.com/shorts/…" />
            </Field>
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
            {e.unidadesPromo && productos[clave(e.sku)] ? (
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
            {resumen(it.sku, it.precioReferencia)}
            <CampoReferencia valor={it.precioReferencia} onChange={(precioReferencia) => setItem(n, { precioReferencia })} />
          </div>
        ))}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Etiqueta de las ofertas">
          <Input value={valor.etiquetaBadge} onChange={(ev) => onChange({ ...valor, etiquetaBadge: ev.target.value })} />
        </Field>
        <Field label="Texto de la referencia">
          <Input value={valor.etiquetaReferencia} onChange={(ev) => onChange({ ...valor, etiquetaReferencia: ev.target.value })} />
        </Field>
      </div>
      <Field label="Legales" hint="Use {inicio}, {fin} y {unidades}: se reemplazan solos.">
        <Textarea value={valor.legales ?? ""} onChange={(ev) => onChange({ ...valor, legales: ev.target.value || undefined })} />
      </Field>
      <Field label="Enlace de 'Ver todas'" hint="Ruta interna (por ejemplo /catalogo). Vacío: no se muestra.">
        <Input value={valor.linkTodos ?? ""} onChange={(ev) => onChange({ ...valor, linkTodos: ev.target.value.trim() || undefined })} />
      </Field>
    </div>
  );
}
