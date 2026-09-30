"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { PostHog } from "posthog-js";
import type { ConfigTracking } from "@/lib/tracking/config";
import { RUTA_INGESTA_POSTHOG } from "@/lib/tracking/config";
import { limpiarEventoPosthog } from "@/lib/tracking/posthog-limpieza";
import { instalarFbq, instalarGtag } from "@/lib/tracking/stubs";
import { activarTracking, type DestinosTracking } from "@/lib/tracking/track";
import { limpiarUrl, rutaSinTracking } from "@/lib/tracking/url";

type ConUrl = { url: string };

/** URL limpia para Vercel (Analytics y Speed Insights); null = no se manda. */
function beforeSendVercel<T extends ConUrl>(evento: T): T | null {
  const u = new URL(evento.url, window.location.origin);
  if (rutaSinTracking(u.pathname)) return null;
  return { ...evento, url: limpiarUrl(u.href) };
}

/**
 * Scripts de tracking y pageviews por navegación. Lo monta `TrackingServidor`
 * sólo con el flag `tracking` prendido. Los IDs vienen validados del server
 * (tracking/config.ts).
 */
export function TrackingCliente({ config }: { config: ConfigTracking }) {
  const pathname = usePathname();
  const posthog = useRef<PostHog | null>(null);
  /** Si la grabación la cortamos nosotros (ruta sin tracking), para reanudarla. */
  const grabacionPausada = useRef(false);

  // fbq/gtag quedan con cola propia apenas se instalan (stubs.ts), así que se
  // registran sin esperar al script remoto. PostHog se importa aparte (no pesa
  // en el bundle con el flag apagado) y recién ahí se activa todo junto, para
  // que los eventos encolados también le lleguen.
  useEffect(() => {
    let cancelado = false;
    if (config.metaPixelId) instalarFbq(window, config.metaPixelId);
    if (config.ga4Id) instalarGtag(window, config.ga4Id);
    const destinos = (): DestinosTracking => ({
      ...(config.metaPixelId && window.fbq ? { fbq: window.fbq } : {}),
      ...(config.ga4Id && window.gtag ? { gtag: window.gtag } : {}),
    });

    if (!config.posthog) {
      activarTracking(destinos());
      return;
    }
    const { key, uiHost } = config.posthog;
    import("posthog-js")
      .then(({ default: ph }) => {
        if (cancelado) return;
        ph.init(key, {
          api_host: RUTA_INGESTA_POSTHOG,
          ui_host: uiHost,
          defaults: "2026-08-30",
          // Pageviews a mano (efecto de abajo): con la URL limpia y salteando
          // las rutas sin tracking.
          capture_pageview: false,
          capture_pageleave: true,
          // Visitantes anónimos sin perfil de persona: más barato y sin datos de más.
          person_profiles: "identified_only",
          session_recording: { maskAllInputs: true },
          disable_session_recording: rutaSinTracking(window.location.pathname),
          before_send: limpiarEventoPosthog,
        });
        posthog.current = ph;
        if (!rutaSinTracking(window.location.pathname)) {
          ph.capture("$pageview", { $current_url: limpiarUrl(window.location.href) });
        }
        activarTracking({ ...destinos(), posthog: ph });
      })
      .catch(() => {
        // Bloqueado o caído: los demás proveedores siguen.
        if (!cancelado) activarTracking(destinos());
      });
    return () => {
      cancelado = true;
    };
  }, [config]);

  // Pageview por navegación (también la primera). Next no recarga la página
  // entre rutas, así que los píxeles no se enteran solos.
  const primera = useRef(true);
  useEffect(() => {
    const url = limpiarUrl(window.location.href);
    const ph = posthog.current;
    if (rutaSinTracking(pathname)) {
      if (ph?.sessionRecordingStarted()) {
        ph.stopSessionRecording();
        grabacionPausada.current = true;
      }
      return;
    }
    if (ph && grabacionPausada.current) {
      ph.startSessionRecording();
      grabacionPausada.current = false;
    }
    try {
      window.fbq?.("track", "PageView");
      if (window.gtag) {
        window.gtag("set", { page_location: url });
        window.gtag("event", "page_view", { page_location: url });
      }
      // La primera la manda el init de PostHog (todavía no cargó acá).
      if (ph && !primera.current) ph.capture("$pageview", { $current_url: url });
    } catch {
      // Medir nunca rompe la navegación.
    }
    primera.current = false;
  }, [pathname]);

  return (
    <>
      <Analytics beforeSend={beforeSendVercel} />
      <SpeedInsights beforeSend={beforeSendVercel} />
      {config.metaPixelId ? (
        <Script id="meta-pixel" strategy="afterInteractive" src="https://connect.facebook.net/en_US/fbevents.js" />
      ) : null}
      {config.ga4Id ? (
        <Script
          id="ga4"
          strategy="afterInteractive"
          src={`https://www.googletagmanager.com/gtag/js?id=${config.ga4Id}`}
        />
      ) : null}
    </>
  );
}
