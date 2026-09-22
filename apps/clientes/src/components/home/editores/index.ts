import type { ComponentType } from "react";
import type { SeccionHome } from "@/data/home-defaults";
import { EditorAnuncio } from "./EditorAnuncio";
import { EditorHero } from "./EditorHero";
import { EditorMarquee } from "./EditorMarquee";
import { EditorNavBadge } from "./EditorNavBadge";
import { EditorPendiente } from "./EditorPendiente";
import { EditorServicios } from "./EditorServicios";
import { EditorWhatsapp } from "./EditorWhatsapp";

export interface EditorProps<T> {
  valor: T;
  onChange: (v: T) => void;
}

/**
 * Registro de editores por sección. En B1 solo están implementados los
 * editores simples (anuncio, hero, marquee, servicios, navBadge, whatsapp);
 * los de ambientes/decoGrid/bannerDeco/destacados llegan en B2.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- registro heterogéneo por sección: cada Editor tipa su propio payload
export const EDITORES: Record<SeccionHome, ComponentType<EditorProps<any>>> = {
  anuncio: EditorAnuncio,
  hero: EditorHero,
  marquee: EditorMarquee,
  ambientes: EditorPendiente,
  destacados: EditorPendiente,
  bannerDeco: EditorPendiente,
  decoGrid: EditorPendiente,
  servicios: EditorServicios,
  navBadge: EditorNavBadge,
  whatsapp: EditorWhatsapp,
};
