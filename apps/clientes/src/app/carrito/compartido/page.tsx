import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@myd-org/ui";
import { CargarCompartido } from "@/components/carrito/CargarCompartido";
import { parsearCompartido, separarDisponibles } from "@/lib/carrito-compartido";
import { productosCompartidos, type ProductoCompartido } from "@/lib/carrito-compartido-datos";
import { fmtPrecio } from "@/lib/format";
import { nombreConMarca } from "@/lib/formato-nombre";
import { formatMarca } from "@/lib/formato-rubro";

/**
 * Preview de un carrito compartido por link (ver src/lib/carrito-compartido.ts).
 *
 * Renderizar esta página NO modifica ningún carrito: WhatsApp y compañía la
 * abren para armar la vista previa. La carga la hace `CargarCompartido` cuando
 * el usuario toca el botón. No va a `RUTAS_PUBLICAS` del proxy: la abre una
 * persona, que pasa por el gate como en cualquier otra página.
 */

type Props = { searchParams: Promise<{ i?: string | string[] }> };

const valor = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const n = parsearCompartido(valor((await searchParams).i)).length;
  return {
    title: "Le compartieron un carrito",
    description: n === 1 ? "1 producto listo para cargar en su carrito." : `${n} productos listos para cargar en su carrito.`,
    robots: { index: false, follow: false },
  };
}

function Linea({ producto, disponible }: { producto: ProductoCompartido; disponible: boolean }) {
  const { item, precioExhibido } = producto;
  const { nombre } = nombreConMarca(item.name, item.brand ? formatMarca(item.brand) : undefined);
  return (
    <li className="flex items-center gap-4 rounded-[22px] bg-surface p-4 shadow-[var(--shadow-1)]">
      <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-elevated">
        {item.image && <Image src={item.image} alt="" fill sizes="64px" className="object-contain p-2" />}
      </div>
      <div className="min-w-0 flex-1">
        {disponible ? (
          <Link href={`/producto/${item.id}`} className="line-clamp-2 font-semibold text-text hover:underline">
            {nombre}
          </Link>
        ) : (
          <p className="line-clamp-2 font-semibold text-muted">{nombre}</p>
        )}
        <p className="text-sm text-muted">
          {item.qty} {item.qty === 1 ? "unidad" : "unidades"}
          {disponible && <> · {fmtPrecio(precioExhibido)} c/u</>}
        </p>
      </div>
      {disponible && (
        <p className="shrink-0 font-semibold text-text">{fmtPrecio(precioExhibido * item.qty)}</p>
      )}
    </li>
  );
}

function SinProductos({ texto }: { texto: string }) {
  return (
    <main className="mx-auto flex w-full max-w-contenido flex-1 flex-col items-center justify-center gap-4 px-4 py-20 text-center">
      <p className="text-2xl font-bold text-text">{texto}</p>
      <Link href="/catalogo">
        <Button>Ver catálogo</Button>
      </Link>
    </main>
  );
}

export default async function CarritoCompartidoPage({ searchParams }: Props) {
  const lineas = parsearCompartido(valor((await searchParams).i));
  if (lineas.length === 0) return <SinProductos texto="Este enlace no tiene productos" />;

  const productos = await productosCompartidos(lineas);
  const porId = new Map(productos.map((p) => [p.item.id, p]));
  const { disponibles, noDisponibles } = separarDisponibles(productos.map((p) => p.item));

  if (disponibles.length === 0) {
    return <SinProductos texto="Los productos de este carrito ya no están disponibles" />;
  }

  const total = disponibles.reduce((a, i) => a + (porId.get(i.id)?.precioExhibido ?? 0) * i.qty, 0);
  const unidades = disponibles.reduce((a, i) => a + i.qty, 0);

  return (
    <main className="mx-auto w-full max-w-contenido flex-1 px-4 pb-16 pt-6 lg:pt-8">
      <h1 className="font-display text-[26px] font-semibold tracking-tight text-text lg:text-[32px]">
        Le compartieron un carrito
      </h1>
      <p className="mb-6 mt-1 text-sm text-muted">
        Revise los productos y cárguelos en su carrito. Los precios son los actuales de la tienda.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-9">
        <div className="flex flex-col gap-6">
          <ul className="flex flex-col gap-3">
            {disponibles.map((i) => (
              <Linea key={i.id} producto={porId.get(i.id)!} disponible />
            ))}
          </ul>

          {noDisponibles.length > 0 && (
            <section aria-labelledby="no-disponibles">
              <h2 id="no-disponibles" className="mb-3 text-sm font-semibold text-muted">
                {noDisponibles.length === 1
                  ? "1 producto de este carrito ya no está disponible y no se va a cargar"
                  : `${noDisponibles.length} productos de este carrito ya no están disponibles y no se van a cargar`}
              </h2>
              <ul className="flex flex-col gap-3 opacity-70">
                {noDisponibles.map((i) => (
                  <Linea key={i.id} producto={porId.get(i.id)!} disponible={false} />
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="h-fit rounded-[20px] border border-border bg-surface p-5 lg:sticky lg:top-24 lg:p-6">
          <div className="mb-1 flex items-baseline justify-between gap-4">
            <span className="text-sm text-muted">
              {unidades} {unidades === 1 ? "unidad" : "unidades"}
            </span>
            <span className="text-xl font-bold text-text">{fmtPrecio(total)}</span>
          </div>
          <p className="mb-4 text-xs text-muted">Total estimado. El precio y el stock se confirman en el carrito.</p>
          <CargarCompartido items={disponibles} />
        </aside>
      </div>
    </main>
  );
}
