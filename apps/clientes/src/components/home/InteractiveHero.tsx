"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { HERO_LIGHTS, proximity, sceneRect } from "./hero-lights";
import styles from "./InteractiveHero.module.css";

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
      paint([]);
    };
    stopIntro.current = stop;
    const resize = new ResizeObserver(() => setRect(sceneRect(surface.clientWidth, surface.clientHeight)));
    resize.observe(surface);
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || entry.intersectionRatio < .35 || started || interrupted || motion.matches) return;
      started = true;
      [4, 2, 3].forEach((index, step) => {
        timers.push(setTimeout(() => paint(HERO_LIGHTS.map((_, i) => i === index ? .85 : 0)), step * 440));
      });
      timers.push(setTimeout(() => paint([]), 1500));
    }, { threshold: .35 });
    observer.observe(surface);
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      stop();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = surface.getBoundingClientRect();
        const fit = sceneRect(bounds.width, bounds.height);
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
      {rect && <>
        <svg aria-hidden="true" className={styles.art} viewBox="0 0 1536 1024" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
          <defs>
            <filter id={`${uid}-blur`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="18" /></filter>
            <radialGradient id={`${uid}-glow`}><stop stopColor="#ffe4b0" stopOpacity=".8" /><stop offset="1" stopColor="#ffe4b0" stopOpacity="0" /></radialGradient>
            <linearGradient id={`${uid}-beam`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#ffe5b4" stopOpacity=".5"/><stop offset="1" stopColor="#ffe5b4" stopOpacity="0"/></linearGradient>
          </defs>
          {HERO_LIGHTS.map((light, i) => <g key={light.id} ref={el => { layers.current[i] = el; }} className={styles.light} style={{ opacity: 0 }} data-light={light.id}>
            {i === 0 && <>
              <ellipse cx="996" cy="346" rx="118" ry="117" fill="none" stroke="#ffe7c2" strokeWidth="32" filter={`url(#${uid}-blur)`}/>
              <ellipse cx="996" cy="346" rx="118" ry="117" fill="none" stroke="#fff6e1" strokeWidth="7"/>
            </>}
            {i === 1 && <>
              <ellipse cx="1006" cy="672" rx="105" ry="110" fill={`url(#${uid}-glow)`}/>
              <ellipse cx="1006" cy="672" rx="46" ry="45" fill="#fff1cc"/>
              <ellipse cx="1006" cy="787" rx="125" ry="24" fill={`url(#${uid}-glow)`}/>
            </>}
            {i === 2 && <>
              <path d="M1176 148 L1200 138 L1400 520 Q1280 590 1170 530 Z" fill={`url(#${uid}-beam)`} filter={`url(#${uid}-blur)`}/>
              <ellipse cx="1188" cy="146" rx="16" ry="8" transform="rotate(-33 1188 146)" fill="#fff5dc"/>
              <ellipse cx="1280" cy="510" rx="120" ry="100" fill={`url(#${uid}-glow)`}/>
            </>}
            {i === 3 && <>
              <path d="M1292 411 L1478 411 L1536 780 L1190 780 Z" fill={`url(#${uid}-beam)`} filter={`url(#${uid}-blur)`}/>
              <ellipse cx="1385" cy="410" rx="98" ry="6" fill="#fff0ca"/>
              <ellipse cx="1385" cy="786" rx="146" ry="28" fill={`url(#${uid}-glow)`}/>
            </>}
            {i === 4 && <>
              <rect x="1087" y="524" width="355" height="17" rx="3" fill="#ffe4ac" filter={`url(#${uid}-blur)`}/>
              <rect x="1087" y="527" width="355" height="11" fill="#fff5dc"/>
              <ellipse cx="1265" cy="560" rx="210" ry="68" fill={`url(#${uid}-glow)`}/>
            </>}
          </g>)}
        </svg>
        {HERO_LIGHTS.map((light, i) => <button key={light.id} type="button" className={styles.target}
          aria-label={light.label} aria-pressed={pressed.includes(i)} onClick={() => toggle(i)}
          style={{ left: rect.left + light.x * rect.scale, top: rect.top + light.y * rect.scale,
            width: (i === 0 ? 220 : i === 4 ? 355 : 96) * rect.scale, height: (i === 0 ? 220 : 96) * rect.scale }} />)}
      </>}
    </div>
  </div>;
}
