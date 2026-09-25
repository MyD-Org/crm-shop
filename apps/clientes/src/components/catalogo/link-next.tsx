"use client";

import Link from "next/link";
import type { RenderLink } from "@myd-org/ui";

/**
 * Enchufe de `next/link` para los componentes del DS que aceptan `renderLink`
 * (Breadcrumb, Pagination, ProductCard, SiteHeader, SiteFooter, PromoBanner…).
 * Único lugar donde el Shop le presta el router de Next al DS: el DS recibe
 * href, clases y aria ya resueltos y sólo cambia el `<a>` por el `<Link>`.
 * Sin esto los enlaces del DS son `<a>` y cada clic recarga la página entera.
 */
export const linkNext: RenderLink = (props) => <Link {...props} />;
