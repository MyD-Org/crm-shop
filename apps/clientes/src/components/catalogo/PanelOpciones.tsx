"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { Button, Dialog, Skeleton, VariantSelector } from "@myd-org/ui";
import { CartIcon, LightbulbIcon } from "@/components/catalogo/iconos";
import { linkNext } from "@/components/catalogo/link-next";
import { useCart } from "@/context/CartContext";
import type { Product } from "@/data/products";
import { usePreciosCuenta } from "@/hooks/usePreciosCuenta";
import { etiquetaStock, textoUnidadesDisponibles } from "@/lib/catalogo-vista";
import { fmtPrecio } from "@/lib/format";
import { nombreDeLinea } from "@/lib/nombre-linea";
import { aplicarEstadoPrecio } from "@/lib/precios-cuenta-estado";
import { opcionInicial, rutaFichaVariante, TEXTOS_PANEL, TEXTOS_VARIANTES } from "@/lib/variantes-ficha";

/** Lo que devuelve `GET /api/shop/variantes`. */
interface Opciones {
  nombre: string;
  marca: string;
  representanteId: string;
  opciones: Product[];
}

export type Carga = { estado: "cargando" } | { estado: "error" } | { estado: "listo"; datos: Opciones };

const MOVIL = "(max-width: 639px)";
const suscribirMovil = (avisar: () => void) => {
  const mq = window.matchMedia(MOVIL);
  mq.addEventListener("change", avisar);
  return () => mq.removeEventListener("change", avisar);
};

/** Mobile: hoja desde abajo (se alcanza con el pulgar y se arrastra para cerrar); desktop: centrado. */
function useEsMovil(): boolean {
  return useSyncExternalStore(
    suscribirMovil,
    () => window.matchMedia(MOVIL).matches,
    () => false,
  );
}

/** El estado de stock de una opción en una frase corta. */
function textoDisponibilidad(p: Product): string {
  if (p.stock === "out") return TEXTOS_VARIANTES.sinStock;
  const unidades = textoUnidadesDisponibles(p);
  if (p.stock === "low") return etiquetaStock(p) ?? "Últimas unidades";
  return unidades ? `En stock · ${unidades}` : "En stock";
}

/**
 * Panel «Agregar» de la card de un modelo con opciones (flag `variantes-selector`): se elige la opción y
 * se agrega al carrito sin salir del listado. Las opciones se piden recién al abrirlo
 * (`GET /api/shop/variantes`); el precio de la cuenta se superpone igual que en la ficha.
 *
 * El `Dialog` va por portal pero los eventos de React suben por el árbol: quien lo use dentro de un
 * `<Link>` debe montarlo como hermano del enlace, no adentro.
 */
export function PanelOpciones({
  producto,
  titulo,
  abierto,
  onAbiertoChange,
}: {
  /** La card (la representante del modelo). */
  producto: Pick<Product, "id" | "images">;
  /** Nombre del modelo tal como lo muestra la card (mientras llegan las opciones). */
  titulo: string;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
}) {
  const [carga, setCarga] = useState<Carga>({ estado: "cargando" });
  const [intento, setIntento] = useState(0);
  const [elegidaId, setElegidaId] = useState<string | null>(null);
  const { addItem } = useCart();
  const movil = useEsMovil();

  const datos = carga.estado === "listo" ? carga.datos : null;
  const yaCargado = datos != null;
  useEffect(() => {
    if (!abierto || yaCargado) return;
    const ctl = new AbortController();
    fetch(`/api/shop/variantes?id=${encodeURIComponent(producto.id)}`, { signal: ctl.signal })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as Opciones | null;
        if (!res.ok || !body?.opciones?.length) throw new Error("sin-opciones");
        setCarga({ estado: "listo", datos: body });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setCarga({ estado: "error" });
      });
    return () => ctl.abort();
  }, [abierto, yaCargado, producto.id, intento]);

  // El precio de la lista privada de la cuenta se superpone en el navegador (sólo con el panel abierto).
  const estados = usePreciosCuenta(abierto && datos ? datos.opciones.map((o) => o.id) : []);
  const opciones = datos?.opciones.map((o) => aplicarEstadoPrecio(o, estados.get(o.id))) ?? [];
  const elegida =
    opciones.find((o) => o.id === elegidaId) ?? opcionInicial(opciones, producto.id) ?? null;

  // Al cerrar con un error, la próxima apertura vuelve a "cargando" y reintenta.
  const alCambiar = useCallback(
    (v: boolean) => {
      if (!v) setCarga((c) => (c.estado === "error" ? { estado: "cargando" } : c));
      onAbiertoChange(v);
    },
    [onAbiertoChange],
  );
  const cerrar = useCallback(() => alCambiar(false), [alCambiar]);

  const noSePuedeAgregar =
    !elegida || elegida.stock === "out" || !(elegida.price > 0) || elegida.precioCuenta === "pendiente";

  function agregar() {
    if (!elegida || noSePuedeAgregar) return;
    // Entra como "Modelo / Opción" y con la foto de la variante.
    addItem({
      id: elegida.id,
      name: nombreDeLinea(elegida),
      brand: elegida.brand,
      price: elegida.price,
      image: elegida.images?.[0]?.url ?? producto.images?.[0]?.url,
    });
    cerrar();
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={alCambiar}
      size="sm"
      placement={movil ? "sheet" : "center"}
      title={titulo}
      description={TEXTOS_PANEL.ayuda}
      footer={
        carga.estado === "error" ? undefined : (
          <PiePanelOpciones
            elegida={carga.estado === "listo" ? elegida : null}
            idDeLaCard={producto.id}
            deshabilitado={carga.estado !== "listo" || noSePuedeAgregar}
            onAgregar={agregar}
            onCerrar={cerrar}
          />
        )
      }
    >
      <CuerpoPanelOpciones
        carga={carga}
        elegida={elegida}
        idDeLaCard={producto.id}
        fotoDeLaCard={producto.images?.[0]}
        onElegir={setElegidaId}
        onReintentar={() => {
          setCarga({ estado: "cargando" });
          setIntento((n) => n + 1);
        }}
        onCerrar={cerrar}
      />
    </Dialog>
  );
}

/**
 * Las acciones del panel, juntas en el pie: la principal arriba y «Ver detalle del producto» como
 * secundaria, las dos a todo el ancho (en el celular quedan al alcance del pulgar).
 */
export function PiePanelOpciones({
  elegida,
  idDeLaCard,
  deshabilitado,
  onAgregar,
  onCerrar,
}: {
  elegida: Product | null;
  idDeLaCard: string;
  deshabilitado: boolean;
  onAgregar: () => void;
  onCerrar: () => void;
}) {
  return (
    <div className="flex w-full flex-col gap-2">
      <Button className="w-full" size="lg" disabled={deshabilitado} onClick={onAgregar}>
        <CartIcon />
        {elegida?.stock === "out" ? TEXTOS_VARIANTES.sinStock : TEXTOS_PANEL.agregarAlCarrito}
      </Button>
      <Button
        className="w-full"
        variant="ghost"
        href={rutaFichaVariante(elegida?.id ?? idDeLaCard)}
        renderLink={linkNext}
        onClick={onCerrar}
      >
        {TEXTOS_PANEL.verDetalle}
      </Button>
    </div>
  );
}

/** El contenido del panel (cargando, error u opción elegida): presentacional, se prueba sin el `Dialog`. */
export function CuerpoPanelOpciones({
  carga,
  elegida,
  idDeLaCard,
  fotoDeLaCard,
  onElegir,
  onReintentar,
  onCerrar,
}: {
  carga: Carga;
  /** La opción elegida con el precio de la cuenta ya aplicado. */
  elegida: Product | null;
  idDeLaCard: string;
  fotoDeLaCard?: { url: string; alt?: string };
  onElegir: (id: string) => void;
  onReintentar: () => void;
  onCerrar: () => void;
}) {
  const datos = carga.estado === "listo" ? carga.datos : null;
  const sinPrecio = elegida != null && !(elegida.price > 0);
  const pendiente = elegida?.precioCuenta === "pendiente";
  const foto = elegida?.images?.[0] ?? fotoDeLaCard;
  return (
    <>
    {carga.estado === "cargando" && (
      <div aria-busy="true" aria-label={TEXTOS_PANEL.cargando} className="space-y-4">
        <div className="flex gap-4">
          <Skeleton className="h-20 w-20 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-6 w-1/2" />
          </div>
        </div>
        <Skeleton className="h-10 w-full" />
      </div>
    )}

    {carga.estado === "error" && (
      <div role="alert" className="space-y-4">
        <p className="text-sm text-text">{TEXTOS_PANEL.error}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="soft" onClick={onReintentar}>
            {TEXTOS_PANEL.reintentar}
          </Button>
          <Button variant="ghost" href={`/producto/${idDeLaCard}`} renderLink={linkNext} onClick={onCerrar}>
            {TEXTOS_PANEL.verDetalle}
          </Button>
        </div>
      </div>
    )}

    {datos && elegida && (
      <div className="space-y-4">
        <div className="flex gap-4">
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md bg-elevated">
            {foto ? (
              <Image src={foto.url} alt={foto.alt ?? ""} fill sizes="80px" className="object-contain p-1" />
            ) : (
              <LightbulbIcon className="absolute inset-0 m-auto h-8 w-8 text-muted/40" />
            )}
          </div>
          <div className="min-w-0 flex-1" aria-live="polite">
            {pendiente ? (
              <Skeleton className="h-7 w-32" />
            ) : sinPrecio ? (
              <p className="text-sm font-semibold text-muted">{TEXTOS_PANEL.sinPrecio}</p>
            ) : (
              <>
                <p className="font-display text-2xl font-bold leading-none tracking-tight text-text tabular-nums">
                  {fmtPrecio(elegida.precioFinal ?? elegida.price)}
                </p>
                {elegida.precioFinal != null && (
                  <p className="mt-1 text-xs text-muted">
                    {TEXTOS_PANEL.sinImpuestos} {fmtPrecio(elegida.price)}
                  </p>
                )}
                {elegida.precioCuenta === "privado" && (
                  <p className="mt-1 text-xs font-semibold text-accent">{TEXTOS_PANEL.precioDeSuCuenta}</p>
                )}
              </>
            )}
            <p className={elegida.stock === "out" ? "mt-2 text-sm text-danger" : "mt-2 text-sm text-muted"}>
              {textoDisponibilidad(elegida)}
            </p>
          </div>
        </div>

        <VariantSelector
          label={TEXTOS_VARIANTES.etiquetaSelector}
          options={datos.opciones.map((o) => ({
            id: o.id,
            label: o.opcion ?? o.name,
            soldOut: o.stock === "out",
          }))}
          value={elegida.id}
          onChange={onElegir}
          soldOutLabel={TEXTOS_VARIANTES.sinStock}
          unavailableLabel={TEXTOS_VARIANTES.noDisponible}
        />
      </div>
    )}
    </>
  );
}
