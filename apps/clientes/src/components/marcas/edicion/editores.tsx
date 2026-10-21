"use client";

import type { ComponentType } from "react";
import { Field, Input, Textarea } from "@myd-org/ui";
import { ListaEditable } from "@/components/home/ListaEditable";
import { CampoImagen } from "@/components/home/editores/CampoImagen";
import { SelectorSkusDestacados } from "@/components/home/editores/SelectorSkusDestacados";
import type { EditorProps } from "@/components/home/editores";
import {
  slugDeNombre,
  type BloqueMarca,
  type ComponentesMarca,
  type ConfianzaMarca,
  type CotizacionMarca,
  type ElegidosMarca,
  type FotoObra,
  type HeroMarca,
  type LineasMarca,
  type ObrasMarca,
  type ProductosMarca,
} from "@/lib/marcas/pagina-marca";

/**
 * Editores de los bloques de una página de marca (spec 2026-10-20 §10). Reusan
 * las piezas del editor de la home (`ListaEditable`, `CampoImagen`,
 * `SelectorSkusDestacados`) para que editar una marca se sienta igual.
 */

export const TITULOS_BLOQUE: Record<BloqueMarca, string> = {
  hero: "Encabezado",
  confianza: "Datos de confianza",
  lineas: "Líneas",
  elegidos: "Los más elegidos",
  componentes: "Componentes",
  obras: "Obras",
  cotizacion: "Cotización de obra",
  productos: "Todos los productos",
};

const lista = (texto: string) =>
  texto
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

function EditorHero({ valor, onChange }: EditorProps<HeroMarca>) {
  return (
    <div className="flex flex-col gap-4">
      <CampoImagen
        label="Imagen de fondo"
        hint="Una foto nocturna de obra funciona muy bien. Se oscurece para que el texto se lea."
        valor={valor.imagen ?? ""}
        onChange={(imagen) => onChange({ ...valor, imagen: imagen || undefined })}
        alt={valor.imagenAlt ?? ""}
        onAltChange={(imagenAlt) => onChange({ ...valor, imagenAlt })}
      />
      <Field label="Sello" hint='Por ejemplo "Tienda oficial · Vendedor oficial online". Vacío: no se muestra.'>
        <Input value={valor.sello ?? ""} onChange={(e) => onChange({ ...valor, sello: e.target.value })} />
      </Field>
      <Field label="Botón" hint="Lleva a la lista de productos; se le suma la cantidad.">
        <Input value={valor.cta ?? ""} onChange={(e) => onChange({ ...valor, cta: e.target.value })} />
      </Field>
    </div>
  );
}

function EditorConfianza({ valor, onChange }: EditorProps<ConfianzaMarca>) {
  return (
    <ListaEditable
      items={valor.items}
      onChange={(items) => onChange({ ...valor, items: items.slice(0, 4) })}
      nuevo={() => ({ valor: "", texto: "" })}
      nombreItem="dato"
      renderItem={(item, onItem) => (
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
          <Field label="Valor" hint='Por ejemplo "+60 años"'>
            <Input value={item.valor} onChange={(e) => onItem({ ...item, valor: e.target.value })} />
          </Field>
          <Field label="Texto" hint='Por ejemplo "de experiencia"'>
            <Input value={item.texto} onChange={(e) => onItem({ ...item, texto: e.target.value })} />
          </Field>
        </div>
      )}
    />
  );
}

function EditorLineas({ valor, onChange }: EditorProps<LineasMarca>) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Título" hint="Vacío: no se muestra.">
        <Input value={valor.titulo ?? ""} onChange={(e) => onChange({ ...valor, titulo: e.target.value })} />
      </Field>
      <ListaEditable
        items={valor.items}
        onChange={(items) => onChange({ ...valor, items })}
        nuevo={() => ({ slug: "", titulo: "", categorias: [], skus: [] })}
        nombreItem="línea"
        renderItem={(item, onItem) => (
          <div className="flex flex-col gap-3">
            <Field label="Nombre de la línea">
              <Input
                value={item.titulo}
                onChange={(e) => onItem({ ...item, titulo: e.target.value, slug: slugDeNombre(e.target.value) })}
              />
            </Field>
            <CampoImagen valor={item.imagen ?? ""} onChange={(imagen) => onItem({ ...item, imagen: imagen || undefined })} />
            <Field
              label="Categorías de la tienda"
              hint="Separadas por coma, como figuran en el catálogo. La línea muestra los productos de la marca en estas categorías."
            >
              <Input
                defaultValue={item.categorias.join(", ")}
                onBlur={(e) => onItem({ ...item, categorias: lista(e.target.value) })}
              />
            </Field>
            <div>
              <p className="mb-2 text-sm font-medium text-text">Productos sueltos</p>
              <p className="mb-2 text-sm text-muted">
                Si los productos de esta línea no están en una categoría propia, elíjalos uno por uno.
              </p>
              <SelectorSkusDestacados skus={item.skus} onChange={(skus) => onItem({ ...item, skus })} />
            </div>
          </div>
        )}
      />
    </div>
  );
}

function EditorElegidos({ valor, onChange }: EditorProps<ElegidosMarca>) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Título">
        <Input value={valor.titulo} onChange={(e) => onChange({ ...valor, titulo: e.target.value })} />
      </Field>
      <Field label="Cantidad" hint="Entre 1 y 12 productos">
        <Input
          type="number"
          min={1}
          max={12}
          value={valor.cantidad}
          onChange={(e) => onChange({ ...valor, cantidad: Number(e.target.value) })}
        />
      </Field>
      <div>
        <p className="mb-2 text-sm text-muted">
          Elija los productos que aparecen primero. El resto se completa con otros productos de la marca.
        </p>
        <SelectorSkusDestacados skus={valor.skus} onChange={(skus) => onChange({ ...valor, skus })} />
      </div>
    </div>
  );
}

function EditorComponentes({ valor, onChange }: EditorProps<ComponentesMarca>) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Título">
        <Input value={valor.titulo} onChange={(e) => onChange({ ...valor, titulo: e.target.value })} />
      </Field>
      <Field label="Bajada">
        <Input value={valor.bajada ?? ""} onChange={(e) => onChange({ ...valor, bajada: e.target.value })} />
      </Field>
      <Field label="Componentes" hint="Separados por coma. Por ejemplo: LED CREE, Driver Philips, IP68.">
        <Textarea defaultValue={valor.chips.join(", ")} onBlur={(e) => onChange({ ...valor, chips: lista(e.target.value) })} />
      </Field>
    </div>
  );
}

function EditorObras({ valor, onChange }: EditorProps<ObrasMarca>) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Título">
        <Input value={valor.titulo} onChange={(e) => onChange({ ...valor, titulo: e.target.value })} />
      </Field>
      <ListaEditable
        items={valor.fotos}
        onChange={(fotos) => onChange({ ...valor, fotos: fotos.slice(0, 6) })}
        nuevo={(): FotoObra => ({ imagen: "", alt: "" })}
        nombreItem="foto"
        renderItem={(item, onItem) => (
          <div className="flex flex-col gap-3">
            <CampoImagen
              valor={item.imagen}
              onChange={(imagen) => onItem({ ...item, imagen })}
              alt={item.alt}
              onAltChange={(alt) => onItem({ ...item, alt })}
            />
            <Field label="Epígrafe" hint="Opcional. Por ejemplo, el nombre de la obra.">
              <Input value={item.epigrafe ?? ""} onChange={(e) => onItem({ ...item, epigrafe: e.target.value })} />
            </Field>
          </div>
        )}
      />
    </div>
  );
}

function EditorCotizacion({ valor, onChange }: EditorProps<CotizacionMarca>) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Título">
        <Input value={valor.titulo} onChange={(e) => onChange({ ...valor, titulo: e.target.value })} />
      </Field>
      <Field label="Bajada">
        <Input value={valor.bajada ?? ""} onChange={(e) => onChange({ ...valor, bajada: e.target.value })} />
      </Field>
      <Field label="Botón">
        <Input value={valor.boton} onChange={(e) => onChange({ ...valor, boton: e.target.value })} />
      </Field>
      <Field label="Mensaje de WhatsApp" hint="Se precarga en el chat con la tienda. Se usa el número de WhatsApp del pie de página.">
        <Textarea value={valor.mensaje} onChange={(e) => onChange({ ...valor, mensaje: e.target.value })} />
      </Field>
    </div>
  );
}

function EditorProductos({ valor, onChange }: EditorProps<ProductosMarca>) {
  return (
    <Field label="Título" hint="Vacío: «Todos los productos» y el nombre de la marca.">
      <Input value={valor.titulo ?? ""} onChange={(e) => onChange({ ...valor, titulo: e.target.value })} />
    </Field>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- registro heterogéneo por bloque: cada Editor tipa su propio payload
export const EDITORES_MARCA: Record<BloqueMarca, ComponentType<EditorProps<any>>> = {
  hero: EditorHero,
  confianza: EditorConfianza,
  lineas: EditorLineas,
  elegidos: EditorElegidos,
  componentes: EditorComponentes,
  obras: EditorObras,
  cotizacion: EditorCotizacion,
  productos: EditorProductos,
};

/** Contenido vacío de cada bloque, para editar uno que todavía no tiene fila. */
export const VACIOS: { [B in BloqueMarca]: unknown } = {
  hero: {},
  confianza: { items: [] },
  lineas: { items: [] },
  elegidos: { titulo: "Los más elegidos", skus: [], cantidad: 8 },
  componentes: { titulo: "Lo que va adentro", chips: [] },
  obras: { titulo: "Obras", fotos: [] },
  cotizacion: { titulo: "", boton: "Pedir cotización de obra", mensaje: "" },
  productos: {},
};
