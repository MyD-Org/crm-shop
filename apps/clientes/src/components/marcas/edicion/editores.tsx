"use client";

import type { ComponentType } from "react";
import { Field, Input, SegmentedControl, Textarea } from "@myd-org/ui";
import { ListaEditable } from "@/components/home/ListaEditable";
import { CampoImagen } from "@/components/home/editores/CampoImagen";
import { SelectorSkusDestacados } from "@/components/home/editores/SelectorSkusDestacados";
import { SelectorCategoriasLinea } from "./SelectorCategoriasLinea";
import type { EditorProps } from "@/components/home/editores";
import {
  slugDeNombre,
  type BloqueMarca,
  type ComponentesMarca,
  type ConfianzaMarca,
  type CotizacionMarca,
  type ElegidosMarca,
  type EmpresaMarca,
  type MediaEmpresa,
  type NivelMarca,
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
  empresa: "La empresa",
  obras: "Obras",
  cotizacion: "Cotización de obra",
  productos: "Todos los productos",
};

const lista = (texto: string) =>
  texto
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

/**
 * Borrador del encabezado: lo que se ve en esa franja. Nombre, bajada y logo son datos de la
 * página (también están en "Datos de la página"); `hero` es el bloque. Lo guarda
 * `guardarEncabezadoMarca` en una sola escritura.
 */
export type BorradorEncabezado = {
  nivel: NivelMarca;
  nombre: string;
  bajada: string;
  logo?: string;
  hero: HeroMarca;
};

function EditorHero({ valor, onChange }: EditorProps<BorradorEncabezado>) {
  const hero = valor.hero;
  const setHero = (cambios: Partial<HeroMarca>) => onChange({ ...valor, hero: { ...hero, ...cambios } });
  const oficial = valor.nivel === "oficial";
  return (
    <div className="flex flex-col gap-4">
      <Field label="Nombre de la marca">
        <Input value={valor.nombre} onChange={(e) => onChange({ ...valor, nombre: e.target.value })} />
      </Field>
      <Field label="Bajada" hint="Una línea de quiénes son. Vacío: no se muestra.">
        <Textarea value={valor.bajada} onChange={(e) => onChange({ ...valor, bajada: e.target.value })} />
      </Field>
      <CampoImagen label="Logo" contener valor={valor.logo ?? ""} onChange={(logo) => onChange({ ...valor, logo: logo || undefined })} />
      {oficial ? (
        <>
          <CampoImagen
            label="Imagen de fondo"
            hint="Una foto nocturna de obra funciona muy bien. Se oscurece para que el texto se lea."
            valor={hero.imagen ?? ""}
            onChange={(imagen) => setHero({ imagen: imagen || undefined })}
            alt={hero.imagenAlt ?? ""}
            onAltChange={(imagenAlt) => setHero({ imagenAlt })}
          />
          <Field label="Sello" hint='Por ejemplo "Tienda oficial · Vendedor oficial online". Vacío: no se muestra.'>
            <Input value={hero.sello ?? ""} onChange={(e) => setHero({ sello: e.target.value })} />
          </Field>
        </>
      ) : null}
      <Field label="Botón" hint="Lleva a la lista de productos; se le suma la cantidad. Vacío: no se muestra.">
        <Input value={hero.cta ?? ""} onChange={(e) => setHero({ cta: e.target.value })} />
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
              hint="La línea muestra los productos de la marca que están en estas categorías."
            >
              <SelectorCategoriasLinea valor={item.categorias} onChange={(categorias) => onItem({ ...item, categorias })} />
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

const DESTINOS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "enlace", label: "Otro enlace" },
];

function EditorCotizacion({ valor, onChange }: EditorProps<CotizacionMarca>) {
  const destino = valor.destino ?? "whatsapp";
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
      <Field label="El botón lleva a">
        <SegmentedControl
          size="sm"
          ariaLabel="A dónde lleva el botón"
          options={DESTINOS}
          value={destino}
          onValueChange={(v) => onChange({ ...valor, destino: v === "enlace" ? "enlace" : undefined })}
        />
      </Field>
      {destino === "enlace" ? (
        <Field
          label="Enlace"
          hint="Una página de la tienda (por ejemplo /contacto), un formulario (https://…), un correo (mailto:…) o un teléfono (tel:…)."
        >
          <Input value={valor.href ?? ""} onChange={(e) => onChange({ ...valor, href: e.target.value })} />
        </Field>
      ) : (
        <>
          <Field
            label="Número de WhatsApp"
            hint="Con código de país y de área, por ejemplo 54 9 223 555 1234. Vacío: el número de WhatsApp del pie de página de la tienda."
          >
            <Input inputMode="tel" value={valor.whatsapp ?? ""} onChange={(e) => onChange({ ...valor, whatsapp: e.target.value })} />
          </Field>
          <Field label="Mensaje" hint="Se precarga en el chat.">
            <Textarea value={valor.mensaje} onChange={(e) => onChange({ ...valor, mensaje: e.target.value })} />
          </Field>
        </>
      )}
    </div>
  );
}

const TIPOS_MEDIA = [
  { value: "foto", label: "Foto" },
  { value: "video", label: "Video" },
];

function EditorEmpresa({ valor, onChange }: EditorProps<EmpresaMarca>) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Título">
        <Input value={valor.titulo} onChange={(e) => onChange({ ...valor, titulo: e.target.value })} />
      </Field>
      <Field label="Bajada" hint="Opcional. Por ejemplo, unas líneas sobre la fábrica o el equipo.">
        <Textarea value={valor.bajada ?? ""} onChange={(e) => onChange({ ...valor, bajada: e.target.value })} />
      </Field>
      <ListaEditable
        items={valor.items}
        onChange={(items) => onChange({ ...valor, items: items.slice(0, 8) })}
        nuevo={(): MediaEmpresa => ({ tipo: "foto", imagen: "", alt: "" })}
        nombreItem="elemento"
        renderItem={(item, onItem) => (
          <div className="flex flex-col gap-3">
            <SegmentedControl
              size="sm"
              ariaLabel="Foto o video"
              options={TIPOS_MEDIA}
              value={item.tipo}
              onValueChange={(t) =>
                onItem(
                  t === "video"
                    ? { tipo: "video", url: "", epigrafe: item.epigrafe }
                    : { tipo: "foto", imagen: "", alt: "", epigrafe: item.epigrafe },
                )
              }
            />
            {item.tipo === "video" ? (
              <Field label="Enlace del video" hint="De YouTube o Vimeo, por ejemplo https://youtu.be/… o https://vimeo.com/…">
                <Input value={item.url} onChange={(e) => onItem({ ...item, url: e.target.value })} />
              </Field>
            ) : (
              <CampoImagen
                valor={item.imagen}
                onChange={(imagen) => onItem({ ...item, imagen })}
                alt={item.alt}
                onAltChange={(alt) => onItem({ ...item, alt })}
              />
            )}
            <Field label="Epígrafe" hint="Opcional.">
              <Input value={item.epigrafe ?? ""} onChange={(e) => onItem({ ...item, epigrafe: e.target.value })} />
            </Field>
          </div>
        )}
      />
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
  empresa: EditorEmpresa,
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
  empresa: { titulo: "Conozca la empresa", items: [] },
  obras: { titulo: "Obras", fotos: [] },
  cotizacion: { titulo: "", boton: "Pedir cotización de obra", mensaje: "" },
  productos: {},
};
