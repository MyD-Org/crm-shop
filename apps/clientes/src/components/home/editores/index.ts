import type { ComponentType } from "react";
import type { SeccionHome } from "@/data/home-defaults";
import { EditorAnuncio } from "./EditorAnuncio";
import { EditorBannerDeco } from "./EditorBannerDeco";
import { EditorDestacados } from "./EditorDestacados";
import { EditorHero } from "./EditorHero";
import { EditorMarquee } from "./EditorMarquee";
import { EditorNavBadge } from "./EditorNavBadge";
import { EditorServicios } from "./EditorServicios";
import { EditorTiles } from "./EditorTiles";
import { EditorWhatsapp } from "./EditorWhatsapp";

export interface EditorProps<T> {
  valor: T;
  onChange: (v: T) => void;
}

/**
 * Registro de editores por sección. Con B2 quedan las 10 `SECCIONES_HOME`
 * cubiertas: `ambientes`/`decoGrid` comparten `EditorTiles` (mismo
 * contrato `SeccionTilesContent`, `decoGrid` además con `chips`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- registro heterogéneo por sección: cada Editor tipa su propio payload
export const EDITORES: Record<SeccionHome, ComponentType<EditorProps<any>>> = {
  anuncio: EditorAnuncio,
  hero: EditorHero,
  marquee: EditorMarquee,
  ambientes: EditorTiles,
  destacados: EditorDestacados,
  bannerDeco: EditorBannerDeco,
  decoGrid: EditorTiles,
  servicios: EditorServicios,
  navBadge: EditorNavBadge,
  whatsapp: EditorWhatsapp,
};
