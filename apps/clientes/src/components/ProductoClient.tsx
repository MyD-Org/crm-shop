"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Button, QuantityStepper } from "@myd-org/ui";
import { PrecioConImpuestos } from "@/components/PrecioConImpuestos";
import { CuotasLinea } from "@/components/CuotasLinea";
import { MediosDePagoModal } from "@/components/MediosDePagoModal";
import { FichaTecnicaModal } from "@/components/FichaTecnicaModal";
import { mejorOpcionCuotas } from "@/lib/cuotas-sin-interes";
import { conPrecioCuenta, usePreciosCuenta } from "@/hooks/usePreciosCuenta";
import { formatDescripcionProducto, nombreConMarca } from "@/lib/formato-nombre";
import { formatMarca, formatRubro } from "@/lib/formato-rubro";
import { maxCantidad, textoUnidadesDisponibles } from "@/lib/catalogo-vista";
import { useCart } from "@/context/CartContext";
import { BotonFavorito } from "@/components/BotonFavorito";
import { BotonCompartir } from "@/components/BotonCompartir";
import { GaleriaProducto } from "@/components/GaleriaProducto";
import { EntregaProducto } from "@/components/producto/EntregaProducto";
import { CONFIG_ENVIO_DEFAULT, type ConfigEnvio } from "@/lib/envio";
import type { DisponibilidadVista, LocalDisponibilidad } from "@/lib/disponibilidad-textos";
import { EspecificacionesProducto } from "@/components/producto/EspecificacionesProducto";
import { DudasProducto } from "@/components/producto/DudasProducto";
import type { Product } from "@/data/products";
import { CartIcon } from "@/components/catalogo/iconos";
import { itemDe } from "@/lib/tracking/eventos";
import { track } from "@/lib/tracking/track";

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/**
 * Las dos caras del botón de agregar ("Agregar al carrito" / "Agregado")
 * apiladas en la misma celda: el botón no cambia de ancho y el cambio es una
 * transición (no keyframes), así que un segundo clic a mitad del cambio lo
 * retoma sin saltos. Misma curva que el resto de las altas; el blur de 2px
 * funde las dos caras para que no se lean superpuestas. Con reduced motion
 * queda sólo el fundido.
 */
const CARA_BOTON =
  "col-start-1 row-start-1 flex items-center justify-center gap-2 transition-[opacity,translate,filter] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:translate-y-0";
const CARA_VISIBLE = "translate-y-0 opacity-100 blur-0";
const CARA_ARRIBA = "-translate-y-2 opacity-0 blur-[2px]";
const CARA_ABAJO = "translate-y-2 opacity-0 blur-[2px]";
/** Cuánto queda "Agregado" antes de volver al texto de siempre. */
const MS_AGREGADO = 1600;

const ESTADO_STOCK: Record<Product["stock"], { texto: string; clases: string }> = {
  in: { texto: "En stock", clases: "bg-success-soft text-success" },
  low: { texto: "Últimas unidades", clases: "bg-warning-soft text-warning" },
  out: { texto: "Sin stock", clases: "bg-danger-soft text-danger" },
};

/** Nombres de Alegra largos ("1 int y 1 toma 10 A (BI) stik superficie"): un escalón menos. */
const LARGO_NOMBRE_EXTENSO = 32;

/**
 * Ficha de producto. Los datos llegan resueltos desde el espejo del catálogo
 * (con el overlay del CRM) via el Server Component `producto/[id]/page.tsx`.
 *
 * Desktop: foto (7/12) con la descripción, la ficha técnica y las
 * especificaciones debajo; a la derecha (5/12) la columna de compra, fija
 * mientras se scrollea (top-24: debajo del header compacto, que aparece fijo al bajar). Mobile: foto 4:3, compra, detalle, y una barra fija
 * abajo con la cantidad y "Agregar al carrito" para que el botón esté siempre
 * a mano. Los bloques sin datos (descripción, ficha técnica,
 * especificaciones, relacionados) no se dibujan: un bloque que siempre dice
 * "no hay" no le sirve a nadie.
 */
export function ProductoClient({
  producto: productoLista,
  configEnvio = CONFIG_ENVIO_DEFAULT,
  envioUbicacion,
  localElegido,
  envioElegido,
  relacionados = null,
  rutaCategorias = [],
  disponibilidad,
}: {
  producto: Product;
  /**
   * Flag `disponibilidad-sucursal`: disponibilidad del producto por modalidad, armada en el server.
   * Ausente = flag apagado (la ficha se ve como siempre).
   */
  disponibilidad?: { producto: DisponibilidadVista; locales: LocalDisponibilidad[] };
  /** Configuración de envío del CRM (reglas de venta): qué se anuncia del envío a domicilio. */
  configEnvio?: ConfigEnvio;
  /** Texto del envío según la ubicación del visitante (componente de servidor en su propio Suspense). */
  envioUbicacion?: ReactNode;
  /** Local de retiro elegido en "Enviar a" (slug): la ficha lo muestra primero. */
  localElegido?: string | null;
  /** Destino del envío elegido en "Enviar a" (calle o localidad): la ficha lo muestra primero. */
  envioElegido?: string | null;
  /** "Más de <categoría>", armado en el server (va en su propio Suspense). */
  relacionados?: ReactNode;
  /** Categoría del admin con sus padres (raíz → hoja), para las migas. Vacío = la de Alegra. */
  rutaCategorias?: string[];
}) {
  // La ficha viene cacheada con la lista general; si el cliente tiene lista
  // propia más barata, se pisa acá (precio, cuotas y el aviso de su cuenta).
  const producto = conPrecioCuenta(
    productoLista,
    usePreciosCuenta([productoLista.id]).get(productoLista.id),
  );
  const [qty, setQty] = useState(1);
  const { addItem } = useCart();
  // Una vista por producto (no por cada cambio de precio de cuenta).
  const idVisto = productoLista.id;
  useEffect(() => {
    track({ tipo: "ver_producto", item: itemDe(productoLista) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a propósito: sólo al cambiar de producto
  }, [idVisto]);
  // Confirmación en el mismo botón: agregar ya no abre el preview del header.
  const [agregado, setAgregado] = useState(false);
  const timerAgregado = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerAgregado.current) clearTimeout(timerAgregado.current);
    },
    [],
  );

  function agregar() {
    addItem({ ...producto, image: producto.images?.[0]?.url }, qty);
    setAgregado(true);
    if (timerAgregado.current) clearTimeout(timerAgregado.current);
    timerAgregado.current = setTimeout(() => setAgregado(false), MS_AGREGADO);
  }

  // Cuotas sobre el precio final unitario: sin IVA conocido no se calcula nada.
  const cuotas = producto.cuotasSinInteres;
  const mejorCuota = mejorOpcionCuotas(cuotas?.opciones);

  const estado = ESTADO_STOCK[producto.stock];
  const agotado = producto.stock === "out";
  // Sin cantidad si es 0 o menos (pasa con la simulación de stock): nada de
  // "En stock: 0 disponibles".
  const disponibles = textoUnidadesDisponibles(producto);
  // Un ítem sin precio en Alegra llega a 0: nunca se ofrece a la venta (ver
  // `conPrecioSql` en src/lib/catalog.ts). La ficha se lee en vivo, así que el
  // filtro de los listados no la cubre y hay que cortar acá también.
  const sinPrecio = !(producto.price > 0);
  // Sólo para mostrar: el nombre real (para buscar, ordenar, SEO/JSON-LD)
  // sigue siendo `producto.name` tal como lo resolvió el servidor.
  const { nombre: nombreParaMostrar } = nombreConMarca(
    producto.name,
    producto.brand ? formatMarca(producto.brand) : undefined
  );
  const nombreExtenso = nombreParaMostrar.length > LARGO_NOMBRE_EXTENSO;

  const selector = (
    // El mismo contador que las cards y el carrito, en su tamaño grande. Sin
    // tacho: acá se elige la cantidad antes de agregar (mínimo 1).
    <QuantityStepper value={qty} onValueChange={setQty} min={1} max={maxCantidad(producto)} tone="soft" size="lg" />
  );
  // El mismo botón en la fila de desktop y en la barra de mobile: una sola
  // cantidad y un solo "Agregado" para los dos.
  const botonAgregar = (
    <Button
      size="lg"
      onClick={agregar}
      disabled={agotado || sinPrecio}
      className="flex min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap"
    >
      <span className="grid">
        <span aria-hidden={agregado} className={`${CARA_BOTON} ${agregado ? CARA_ARRIBA : CARA_VISIBLE}`}>
          <CartIcon />
          {sinPrecio ? "Consulte el precio" : agotado ? "Sin stock" : "Agregar al carrito"}
        </span>
        <span aria-hidden={!agregado} className={`${CARA_BOTON} ${agregado ? CARA_VISIBLE : CARA_ABAJO}`}>
          <CheckIcon />
          Agregado
        </span>
      </span>
    </Button>
  );

  const detalle = (
    <>
      {(producto.description || producto.fichaTecnicaUrl) && (
        <section aria-labelledby={producto.description ? "descripcion-titulo" : undefined}>
          {producto.description && (
            <>
              <h2 id="descripcion-titulo" className="mb-3 font-display text-lg font-semibold text-text">
                Descripción
              </h2>
              <p className="max-w-prose whitespace-pre-line text-[15px] leading-relaxed text-text">
                {formatDescripcionProducto(
                  producto.description,
                  producto.brand ? formatMarca(producto.brand) : undefined
                )}
              </p>
            </>
          )}
          {/* Ficha técnica: sólo si el CRM cargó un PDF para este producto. */}
          {producto.fichaTecnicaUrl && (
            <div className={producto.description ? "mt-4" : undefined}>
              <FichaTecnicaModal url={producto.fichaTecnicaUrl} nombreProducto={nombreParaMostrar} />
            </div>
          )}
        </section>
      )}
      <EspecificacionesProducto filas={producto.especificaciones} />
    </>
  );

  return (
    <>
      <main className="mx-auto w-full max-w-contenido flex-1 px-4 pt-6 lg:pb-16 lg:pt-8">
        {/* Breadcrumb */}
        <nav className="mb-5 truncate text-sm text-muted lg:mb-6">
          <Link href="/" className="text-muted transition-colors hover:text-accent">Inicio</Link>
          {(rutaCategorias.length ? rutaCategorias : producto.category ? [producto.category] : []).map((c) => (
            <Fragment key={c}>
              {" / "}
              <Link
                href={`/catalogo?categoria=${encodeURIComponent(c)}`}
                className="text-muted transition-colors hover:text-accent"
              >
                {formatRubro(c)}
              </Link>
            </Fragment>
          ))}
          {" / "}
          <span className="text-text">{nombreParaMostrar}</span>
        </nav>

        {/* Grilla con áreas: en mobile galería → compra → detalle; desde lg el
            detalle sube debajo de la galería y la compra ocupa la columna
            derecha entera (así puede quedar fija con sticky). */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-x-12 lg:gap-y-10">
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <GaleriaProducto
              fotos={producto.images}
              nombre={nombreParaMostrar}
              acciones={
                <>
                  <BotonCompartir titulo={nombreParaMostrar} />
                  {/* En desktop el favorito va junto al botón de compra. */}
                  <span className="lg:hidden">
                    <BotonFavorito productId={producto.id} />
                  </span>
                </>
              }
            />
          </div>

          <aside className="min-w-0 space-y-6 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
            <div>
              {producto.brand && (
                <Link
                  href={`/catalogo?marca=${encodeURIComponent(producto.brand)}`}
                  className="text-sm font-bold text-accent transition-colors hover:text-primary"
                >
                  {formatMarca(producto.brand)}
                </Link>
              )}
              <h1
                className={`mt-1 text-balance font-display font-semibold leading-[1.08] tracking-tight text-text ${
                  nombreExtenso ? "text-2xl lg:text-[30px]" : "text-[30px] lg:text-[40px]"
                }`}
              >
                {nombreParaMostrar}
              </h1>
              {producto.sku && (
                <p className="mt-3 flex items-center gap-2 text-[13px] text-muted">
                  Código
                  <span className="rounded-md bg-elevated px-2 py-0.5 font-bold tracking-wide text-text">
                    {producto.sku}
                  </span>
                </p>
              )}
            </div>

            <div>
              {sinPrecio ? (
                <p className="text-lg font-semibold text-muted">
                  Precio no disponible. Consulte por WhatsApp o por teléfono.
                </p>
              ) : (
                <PrecioConImpuestos
                  price={producto.price}
                  precioFinal={producto.precioFinal}
                  precioLista={producto.precioEspecial ? producto.oldPrice : undefined}
                  preciosMedios={producto.preciosMedios}
                />
              )}
              {!sinPrecio && mejorCuota && cuotas && producto.precioFinal != null && (
                <div className="mt-3">
                  <CuotasLinea opcion={mejorCuota} tono="claro" tamano="lg" className="block" />
                  <MediosDePagoModal
                    precioFinal={producto.precioFinal}
                    cuotas={cuotas}
                    className="mt-0.5 text-accent transition-colors hover:text-primary"
                  />
                </div>
              )}
            </div>

            <p className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${estado.clases}`}>
              <span className="h-2 w-2 rounded-full bg-current" aria-hidden />
              {estado.texto}
              {disponibles && `: ${disponibles}`}
            </p>

            {/* Cantidad + agregar (desktop; en mobile va en la barra fija). */}
            <div className="hidden items-center gap-3 lg:flex">
              {selector}
              {botonAgregar}
              <BotonFavorito productId={producto.id} />
            </div>

            <EntregaProducto
              configEnvio={configEnvio}
              envioUbicacion={envioUbicacion}
              disponibilidad={disponibilidad}
              localElegido={localElegido}
              envioElegido={envioElegido}
            />

            {/* Preguntas sugeridas al asesor: sólo con el chat montado. */}
            <DudasProducto producto={producto} />
          </aside>

          <div className="min-w-0 space-y-10 lg:col-start-1 lg:row-start-2">{detalle}</div>
        </div>

        {relacionados}

        {/* Barra de compra en mobile. Sticky (no fixed) y última del main:
            acompaña todo el scroll de la ficha y se detiene donde empieza el
            footer, así nunca lo tapa. `data-barra-compra`: el launcher del
            chat se corre arriba de ella (globals.css). */}
        <div data-sin-footer-mobile data-barra-compra className="sticky bottom-0 z-30 -mx-4 mt-10 border-t border-border bg-surface/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
          <div className="flex items-center gap-3">
            {selector}
            {botonAgregar}
          </div>
        </div>
      </main>

      {/* El cambio de texto del botón no se anuncia solo. */}
      <span role="status" className="sr-only">
        {agregado ? "Producto agregado al carrito." : ""}
      </span>
    </>
  );
}
