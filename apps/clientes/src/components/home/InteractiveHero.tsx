"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { COVER_QUERY, HERO_LIGHTS, SHELF_STRIP, STUDIO_IMAGE_MOBILE, proximity, sceneRect } from "./hero-lights";
import styles from "./InteractiveHero.module.css";

/** Each lamp of the first-view intro stays on this long; the fade matches `[data-intro]` in the CSS module. */
const INTRO_STEP_MS = 1400;
const INTRO_FADE_MS = 900;
/** Intro order: shelf strip, spot, pendant, table lamp. */
const INTRO_SEQUENCE = ["linear", "spot", "pendant", "bulb"].map(id => HERO_LIGHTS.findIndex(light => light.id === id));
/** While the hero is on screen, every this many px of scroll lights the next lamp, held this long after scrolling stops. */
const SCROLL_STEP_PX = 90;
const SCROLL_HOLD_MS = 700;

/** Keeps the DS Hero and its content intact. Only the background is enhanced. */
export function InteractiveHero({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const layers = useRef<(SVGGElement | null)[]>([]);
  const pinned = useRef(new Set<number>());
  const stopIntro = useRef<() => void>(() => {});
  const [pressed, setPressed] = useState<number[]>([]);
  const [rect, setRect] = useState<ReturnType<typeof sceneRect> | null>(null);
  const uid = useId().replaceAll(":", "");

  useEffect(() => {
    if (!enabled || !root.current || !scene.current) return;
    const host = root.current;
    const surface = scene.current;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const cover = matchMedia(COVER_QUERY);
    let interrupted = false;
    let started = false;
    let frame = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const paint = (values: number[]) => layers.current.forEach((layer, i) => {
      if (layer) layer.style.opacity = String(pinned.current.has(i) ? 1 : values[i] ?? 0);
    });
    const stop = () => {
      interrupted = true;
      timers.forEach(clearTimeout);
      delete host.dataset.intro;
      paint([]);
    };
    stopIntro.current = stop;
    const resize = new ResizeObserver(() => {
      setRect(sceneRect(surface.clientWidth, surface.clientHeight, cover.matches));
    });
    resize.observe(surface);
    let visible = false;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (!entry.isIntersecting || entry.intersectionRatio < .35 || started || interrupted || motion.matches) return;
      started = true;
      host.dataset.intro = "";
      const sequence = INTRO_SEQUENCE;
      sequence.forEach((index, step) => {
        timers.push(setTimeout(() => paint(HERO_LIGHTS.map((_, i) => i === index ? .85 : 0)), step * INTRO_STEP_MS));
      });
      timers.push(setTimeout(() => paint([]), sequence.length * INTRO_STEP_MS));
      timers.push(setTimeout(() => { delete host.dataset.intro; }, sequence.length * INTRO_STEP_MS + INTRO_FADE_MS));
    }, { threshold: .35 });
    observer.observe(surface);
    // Scrolling lights one lamp at a time, never the same one twice in a row;
    // each lamp comes up once before any repeats.
    let lastY = scrollY;
    let lastLight = -1;
    let bag: number[] = [];
    let scrollTimer: ReturnType<typeof setTimeout> | undefined;
    const scroll = () => {
      if (!visible || motion.matches || "intro" in host.dataset) { lastY = scrollY; return; }
      if (Math.abs(scrollY - lastY) < SCROLL_STEP_PX) return;
      lastY = scrollY;
      if (!bag.length) {
        bag = HERO_LIGHTS.map((_, i) => i).sort(() => Math.random() - .5);
        if (bag[0] === lastLight) bag.push(bag.shift()!);
      }
      lastLight = bag.shift()!;
      paint(HERO_LIGHTS.map((_, i) => i === lastLight ? .85 : 0));
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => paint([]), SCROLL_HOLD_MS);
    };
    addEventListener("scroll", scroll, { passive: true });
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      stop();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = surface.getBoundingClientRect();
        const fit = sceneRect(bounds.width, bounds.height, cover.matches);
        if (!fit.scale) return;
        const x = (event.clientX - bounds.left - fit.left) / fit.scale;
        const y = (event.clientY - bounds.top - fit.top) / fit.scale;
        paint(HERO_LIGHTS.map(light => proximity(x, y, light)));
      });
    };
    const leave = () => { cancelAnimationFrame(frame); paint([]); };
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerdown", stop);
    host.addEventListener("keydown", stop);
    host.addEventListener("pointerleave", leave);
    motion.addEventListener("change", stop);
    return () => {
      stop(); cancelAnimationFrame(frame); resize.disconnect(); observer.disconnect();
      clearTimeout(scrollTimer);
      removeEventListener("scroll", scroll);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerdown", stop);
      host.removeEventListener("keydown", stop);
      host.removeEventListener("pointerleave", leave);
      motion.removeEventListener("change", stop);
    };
  }, [enabled]);

  function toggle(index: number) {
    stopIntro.current();
    if (pinned.current.has(index)) pinned.current.delete(index);
    else pinned.current.add(index);
    setPressed([...pinned.current]);
    layers.current.forEach((layer, i) => { if (layer) layer.style.opacity = pinned.current.has(i) ? "1" : "0"; });
  }

  if (!enabled) return <>{children}</>;
  return <div ref={root} className={styles.root} data-interactive-hero="">
    {children}
    <div ref={scene} className={styles.scene}>
      {/* Phones get their own source; elsewhere it never matches and nothing loads. */}
      <picture className={styles.mobilePhoto}>
        <source media={COVER_QUERY} srcSet={STUDIO_IMAGE_MOBILE} />
        <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="" />
      </picture>
      {rect && <>
        <svg aria-hidden="true" className={styles.art} viewBox="0 0 1536 1024" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
          <defs>
            <filter id={`${uid}-blur`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="18" /></filter>
            <filter id={`${uid}-soft`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" /></filter>
            <clipPath id={`${uid}-belowShade`}><rect x="1100" y="662" width="245" height="148"/></clipPath>
            <radialGradient id={`${uid}-glow`}><stop stopColor="#ffe4b0" stopOpacity=".8" /><stop offset="1" stopColor="#ffe4b0" stopOpacity="0" /></radialGradient>
            <linearGradient id={`${uid}-beam`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#ffe5b4" stopOpacity=".5"/><stop offset="1" stopColor="#ffe5b4" stopOpacity="0"/></linearGradient>
            <clipPath id={`${uid}-basket`}><path d="M1370 234 Q1360 278 1311 300 Q1263 322 1271 366 Q1278 401 1311 417 Q1385 437 1462 417 Q1496 402 1500 365 Q1507 323 1465 300 Q1416 277 1403 234 Z"/></clipPath>
            <radialGradient id={`${uid}-interior`}><stop stopColor="#fff4ce" stopOpacity=".95"/><stop offset=".25" stopColor="#ffe0a0" stopOpacity=".65"/><stop offset="1" stopColor="#ffcb7a" stopOpacity="0"/></radialGradient>
          </defs>
          {HERO_LIGHTS.map((light, i) => <g key={light.id} ref={el => { layers.current[i] = el; }} className={styles.light} style={{ opacity: 0 }} data-light={light.id}>
            {light.id === "bulb" && <>
              {/* BELL-N is opaque above its lower rim: emission only below the shade. */}
              <g clipPath={`url(#${uid}-belowShade)`}>
                <path d="M1168 661 L1274 661 L1315 777 Q1221 803 1127 777 Z" fill={`url(#${uid}-beam)`} filter={`url(#${uid}-soft)`}/>
              </g>
              <ellipse cx="1221" cy="660" rx="52" ry="2.4" fill="#fff2d1"/>
              <ellipse cx="1221" cy="781" rx="96" ry="19" fill={`url(#${uid}-glow)`}/>
              <path d="M1223 666 L1223 771" stroke="#ffe7bc" strokeWidth="1.3" opacity=".4"/>
            </>}
            {light.id === "spot" && <>
              {/* Track spot aimed down and to the left (~30°), at the free wall; lens at (1126, 146). */}
              <path d="M1136 152 L1116 140 L830 520 Q930 592 1034 540 Z" fill={`url(#${uid}-beam)`} filter={`url(#${uid}-blur)`}/>
              <ellipse cx="1126" cy="146" rx="12" ry="7" transform="rotate(30 1126 146)" fill="#fff5dc"/>
              <ellipse cx="930" cy="512" rx="120" ry="100" fill={`url(#${uid}-glow)`}/>
            </>}
            {light.id === "pendant" && <>
              {/* Translucent inner glow preserves the photographic bamboo weave. */}
              <ellipse cx="1385" cy="359" rx="144" ry="118" fill={`url(#${uid}-interior)`} opacity=".3"/>
              <g clipPath={`url(#${uid}-basket)`}>
                <ellipse cx="1385" cy="359" rx="104" ry="78" fill={`url(#${uid}-interior)`}/>
              </g>
              <path d="M1320 423 L1450 423 L1536 780 L1234 780 Z" fill={`url(#${uid}-beam)`} filter={`url(#${uid}-blur)`}/>
              <ellipse cx="1385" cy="786" rx="146" ry="25" fill={`url(#${uid}-glow)`}/>
            </>}
            {light.id === "linear" && <>
              {/* No fixture in the photo: a hidden strip lights the shelf's underside edge to edge. */}
              <rect x={SHELF_STRIP.x} y={SHELF_STRIP.y - 3} width={SHELF_STRIP.width} height="10" fill="#ffe4ac" filter={`url(#${uid}-soft)`}/>
              <rect x={SHELF_STRIP.x + 4} y={SHELF_STRIP.y} width={SHELF_STRIP.width - 4} height="3" fill="#fff5dc"/>
              <rect x={SHELF_STRIP.x} y={SHELF_STRIP.y + 2} width={SHELF_STRIP.width} height="96" fill={`url(#${uid}-beam)`} filter={`url(#${uid}-soft)`}/>
            </>}
          </g>)}
        </svg>
        {HERO_LIGHTS.map((light, i) => <button key={light.id} type="button" className={styles.target}
          aria-label={light.label} aria-pressed={pressed.includes(i)} onClick={() => toggle(i)}
          style={{ left: rect.left + light.x * rect.scale, top: rect.top + light.y * rect.scale,
            width: (light.id === "linear" ? SHELF_STRIP.width : 96) * rect.scale, height: 96 * rect.scale }} />)}
      </>}
    </div>
  </div>;
}
