# Plan — @myd-org/ui: tema editorial + componentes site (v0.11.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar al design system el tema visual "editorial" (paleta cálida crema/tinta/ámbar del rediseño de Central LED) y los componentes de storefront que lo consumen, y publicar la versión `0.11.0`.

**Architecture:** Tema aditivo activado con `[data-theme='editorial']`, siguiendo el mecanismo exacto del tema dark existente. Nuevos roles de token (`--color-highlight`, `--color-accent-soft`, `--font-display`) declarados en los tres bloques (`:root`, dark, editorial) y mapeados en `tailwind.css` (`@theme inline`). Componentes nuevos con el patrón del repo: `forwardRef` + `cva` + `cn`, clases solo con utilidades respaldadas por tokens (excepciones arbitrary-values documentadas: gradientes). Todo es aditivo: el tema default y los consumidores actuales no cambian.

**Tech Stack:** React 19, Tailwind 4 (`@theme inline`), class-variance-authority, vitest + testing-library (jsdom), Storybook 10, tsup.

**Working directory:** `~/Documents/Fede/ui` (TODO el plan corre en este repo, no en Shop).

**Spec:** `../Shop/docs/superpowers/specs/2026-09-17-rediseno-editorial-design.md`

**Antes de arrancar:** leer `CLAUDE.md` del repo (convenciones TDD y "SDUI-ready": props planas/serializables, datos como arrays, no children JSX para contenido). Estado verificado 2026-09-17: rama `main` limpia y sincronizada, node_modules instalado, versión actual 0.10.0.

**Branch:** `git checkout -b feat/editorial-theme`

---

### Task 1: Roles nuevos de color + tema editorial en `tokens.css`

**Files:**
- Modify: `src/styles/tokens.css`
- Test: `src/styles/tokens.test.ts` (create)

- [ ] **Step 1: Escribir el test que falla**

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const css = readFileSync(
  resolve(fileURLToPath(import.meta.url), "..", "tokens.css"),
  "utf8",
);

describe("tema editorial", () => {
  it("existe el selector dual .editorial / [data-theme='editorial']", () => {
    expect(css).toMatch(/\.editorial,\s*\n?\[data-theme='editorial'\]/);
  });

  it("usa la paleta cálida del rediseño", () => {
    const bloque = css.split("[data-theme='editorial']")[1];
    expect(bloque).toContain("--color-bg: #f7f2ea");
    expect(bloque).toContain("--color-surface: #fffcf7");
    expect(bloque).toContain("--color-text: #33291f");
    expect(bloque).toContain("--color-primary: #33291f");
    expect(bloque).toContain("--color-accent: #c07a2b");
    expect(bloque).toContain("--color-accent-strong: #b3603f");
    expect(bloque).toContain("--font-display: 'Fraunces', Georgia, serif");
    expect(bloque).toContain("--font-sans: 'Nunito Sans'");
  });

  it("los roles nuevos existen en el default :root (contrato completo)", () => {
    const root = css.split(".dark")[0];
    expect(root).toContain("--color-highlight:");
    expect(root).toContain("--color-accent-soft:");
    expect(root).toContain("--font-display:");
  });

  it("los roles nuevos existen también en dark", () => {
    const dark = css.split("[data-theme='dark']")[1];
    expect(dark).toContain("--color-highlight:");
    expect(dark).toContain("--color-accent-soft:");
    expect(dark).toContain("--font-display:");
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/styles/tokens.test.ts`
Expected: FAIL — `[data-theme='editorial']` no existe; los roles nuevos tampoco.

- [ ] **Step 3: Implementar**

En `src/styles/tokens.css`:

a) En el bloque `:root` (theme default), agregar al final de los roles (antes de `--radius-sm`):

```css
  --color-accent-soft: #e8e8ea;
  --color-highlight: #f0c98f;
```

y reemplazar la línea `--font-sans:` del default por:

```css
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, sans-serif;
  --font-display: Georgia, "Times New Roman", serif;
```

b) En el bloque `.dark, [data-theme='dark']`, agregar los mismos tres roles (valores dark):

```css
  --color-accent-soft: #27272a;
  --color-highlight: #f0c98f;
  --font-display: Georgia, "Times New Roman", serif;
```

c) Agregar al final del archivo el bloque del tema editorial (después del bloque dark), con el mismo formato dual que dark:

```css
/* Editorial — storefront Central LED (crema/tinta/ámbar). Se activa con
   data-theme="editorial" (o la clase .editorial) en un ancestro. Redeclara
   los MISMOS roles: componentes y charts heredan el tema sin tocar código. */
.editorial,
[data-theme='editorial'] {
  --color-bg: #f7f2ea;
  --color-surface: #fffcf7;
  --color-elevated: #efe7da;
  --color-border: rgba(51, 41, 31, 0.14);
  --color-ring: rgba(192, 122, 43, 0.28);
  --color-text: #33291f;
  --color-muted: #8a7a66;
  --color-subtle: #b3a48e;
  --color-primary: #33291f;
  --color-primary-hover: #c07a2b;
  --color-primary-soft: #f3e3cb;
  --color-on-primary: #f7f2ea;
  --color-border-strong: rgba(51, 41, 31, 0.26);
  --color-accent: #c07a2b;
  --color-accent-strong: #b3603f;
  --color-accent-soft: #f3e3cb;
  --color-highlight: #f0c98f;
  --color-success: #15803d;
  --color-success-soft: #effaf2;
  --color-danger: #e1242f;
  --color-danger-soft: #fdecec;
  --color-warning: #b45309;
  --color-warning-soft: #fbf0db;
  --color-info: #c07a2b;
  --color-info-soft: #f3e3cb;
  --color-surface-dark: #33291f;
  --color-surface-darker: #241c14;
  --color-on-surface-dark: #f7f2ea;
  --font-sans: 'Nunito Sans', ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-display: 'Fraunces', Georgia, serif;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/styles/tokens.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/styles/tokens.css src/styles/tokens.test.ts
git commit -m "feat(tokens): roles highlight/accent-soft/font-display + tema editorial"
```

---

### Task 2: Mapeo en `tailwind.css` (`@theme inline`) + animación marquee

**Files:**
- Modify: `src/styles/tailwind.css`
- Test: `src/styles/tokens.test.ts` (agregar describe)

- [ ] **Step 1: Agregar tests que fallan**

En `src/styles/tokens.test.ts` agregar:

```ts
const tailwind = readFileSync(
  resolve(fileURLToPath(import.meta.url), "..", "tailwind.css"),
  "utf8",
);

describe("mapeo tailwind", () => {
  it("mapea los roles nuevos a @theme inline", () => {
    expect(tailwind).toContain("--color-highlight: var(--color-highlight);");
    expect(tailwind).toContain("--color-accent-soft: var(--color-accent-soft);");
    expect(tailwind).toContain("--font-display: var(--font-display);");
  });

  it("define la animación marquee con keyframes", () => {
    expect(tailwind).toContain("--animate-marquee:");
    expect(tailwind).toContain("@keyframes marquee");
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/styles/tokens.test.ts`
Expected: FAIL en los 2 tests nuevos.

- [ ] **Step 3: Implementar**

En `src/styles/tailwind.css`, dentro del bloque `@theme inline { ... }`, agregar después de `--font-sans: var(--font-sans);`:

```css
  --color-accent-soft: var(--color-accent-soft);
  --color-highlight: var(--color-highlight);
  --font-display: var(--font-display);
  --animate-marquee: marquee 32s linear infinite;

  @keyframes marquee {
    to {
      transform: translateX(-50%);
    }
  }
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/styles/tokens.test.ts`
Expected: PASS (6 tests totales).

- [ ] **Step 5: Commit**

```bash
git add src/styles/tailwind.css src/styles/tokens.test.ts
git commit -m "feat(tailwind): mapeo de roles editoriales + keyframes marquee"
```

---

### Task 3: `ProductCard` — variant `editorial` (retro-compatible)

**Files:**
- Modify: `src/components/ProductCard.tsx`
- Test: `src/components/ProductCard.test.tsx` (agregar tests)

- [ ] **Step 1: Tests que fallan**

En `src/components/ProductCard.test.tsx` agregar (manteniendo los tests existentes):

```tsx
describe('variant editorial', () => {
  it('aplica la card editorial: radius 20px y sombra elevada', () => {
    render(<ProductCard variant="editorial" name="Panel LED" price={1000} />);
    expect(screen.getByText('Panel LED').closest('div')?.className).toContain('rounded-[20px]');
  });

  it('precio en tipografía display serif', () => {
    render(<ProductCard variant="editorial" name="Panel LED" price={1000} />);
    const precio = screen.getByText(/\$|1\.000/);
    expect(precio.className).toContain('font-display');
  });

  it('no muestra el indicador de stock (el mockup editorial no lo lleva)', () => {
    render(<ProductCard variant="editorial" name="Panel LED" price={1000} stock="in" />);
    expect(screen.queryByText('En stock')).toBeNull();
  });

  it('la variant default sigue mostrando stock (regresión)', () => {
    render(<ProductCard name="Panel LED" price={1000} stock="in" />);
    expect(screen.getByText('En stock')).toBeInTheDocument();
  });
});
```

Nota: `$ 1.000` se forma con `Intl.NumberFormat('es-AR')`; si el entorno no produce `\$`, el segundo test usa `/1\.000/` que es robusto.

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/components/ProductCard.test.tsx`
Expected: FAIL — la prop `variant` no existe (TS error en runtime de vitest: prop desconocida, y las clases no aparecen).

- [ ] **Step 3: Implementar**

En `src/components/ProductCard.tsx`:

a) Agregar el import de cva (ya está importado `cn` desde `../lib/cn`; agregar):

```tsx
import { cva, type VariantProps } from 'class-variance-authority';
```

b) Agregar dos cva arriba del componente:

```tsx
const card = cva(
  'group flex flex-col overflow-hidden transition-shadow duration-200',
  {
    variants: {
      variant: {
        default: 'cursor-default rounded-lg border border-border bg-surface hover:shadow-2',
        editorial: 'cursor-pointer rounded-[20px] border border-border/50 bg-surface hover:shadow-2',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

const priceText = cva('', {
  variants: {
    variant: {
      default: 'text-lg font-bold text-text',
      editorial: 'font-display text-[22px] font-semibold tracking-tight text-text',
    },
  },
  defaultVariants: { variant: 'default' },
});
```

c) Extender las props:

```tsx
export interface ProductCardProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof card> {
  // ...props existentes sin cambios...
}
export type ProductCardVariant = NonNullable<VariantProps<typeof card>['variant']>;
```

d) En el render, desestructurar `variant` y aplicar:

```tsx
export function ProductCard({ className, variant, image, badge, brand, name, stock = 'in', stockLabel, price, oldPrice, discount, currency = 'ARS', locale = 'es-AR', action, priceNote, installments, ...props }: ProductCardProps) {
  return (
    <div className={cn(card({ variant }), className)} {...props}>
```

y en el span del precio:

```tsx
<span className={priceText({ variant })}>{fmt(price)}</span>
```

y envolver el indicador de stock para que solo renderice en default:

```tsx
{variant !== 'editorial' && (
  <span className={stockIndicator({ stock })}>
    <span className={stockDot({ stock })} />
    {stockLabel ?? stockLabels[stock]}
  </span>
)}
```

e) En el body, cuando es editorial, padding ligeramente mayor: en el div del body cambiar `p-4` por `p-4 data-[variant=editorial]:p-5` NO — más simple: dejar `p-4` (la diferencia es menor y no justifica complejidad; YAGNI).

- [ ] **Step 4: Correr tests**

Run: `npx vitest run src/components/ProductCard.test.tsx`
Expected: PASS (todos, incluidos los 4 nuevos y los anteriores sin tocar).

- [ ] **Step 5: Agregar story y export del type**

En `src/components/ProductCard.stories.tsx` agregar:

```tsx
export const Editorial: Story = {
  args: {
    variant: 'editorial',
    brand: 'Macroled',
    name: 'Lámpara LED filamento vintage 8W E27 luz cálida',
    price: 2667,
    installments: '6 cuotas de $ 445',
    badge: <span className="rounded-full bg-surface px-3 py-1.5 text-[10.5px] font-extrabold uppercase tracking-widest text-accent-strong">Más vendido</span>,
  },
};
```

En `src/index.ts`, en la línea de ProductCard agregar el type (la línea existente es `export { ProductCard, type ProductCardProps, type ProductStock } from './components/ProductCard';`):

```ts
export { ProductCard, type ProductCardProps, type ProductCardStock, type ProductCardVariant } from './components/ProductCard';
```

Ojo: verificar el nombre real exportado hoy (`ProductStock` vs `ProductCardStock`) leyendo `src/index.ts` antes de editar; mantener el nombre existente y solo sumar `type ProductCardVariant`.

- [ ] **Step 6: typecheck + commit**

Run: `npm run typecheck && npm test`
Expected: PASS.

```bash
git add src/components/ProductCard.tsx src/components/ProductCard.test.tsx src/components/ProductCard.stories.tsx src/index.ts
git commit -m "feat(ProductCard): variant editorial del rediseño Central LED"
```

---

### Task 4: `ChipRow`

**Files:**
- Create: `src/components/ChipRow.tsx`
- Test: `src/components/ChipRow.test.tsx`
- Story: `src/components/ChipRow.stories.tsx`

- [ ] **Step 1: Test que falla**

```tsx
import { render, screen } from '@testing-library/react';
import { ChipRow } from './ChipRow';

describe('ChipRow', () => {
  it('renderiza un chip por item', () => {
    render(<ChipRow chips={[{ label: 'Apliques' }, { label: 'Faroles solares' }]} />);
    expect(screen.getByText('Apliques')).toBeInTheDocument();
    expect(screen.getByText('Faroles solares')).toBeInTheDocument();
  });

  it('los chips con href son links', () => {
    render(<ChipRow chips={[{ label: 'Smart / Wi-Fi', href: '/catalogo' }]} />);
    const link = screen.getByRole('link', { name: 'Smart / Wi-Fi' });
    expect(link).toHaveAttribute('href', '/catalogo');
    expect(link.className).toContain('rounded-full');
  });

  it('los chips sin href son spans', () => {
    render(<ChipRow chips={[{ label: 'Efecto fuego' }]} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/components/ChipRow.test.tsx`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

`src/components/ChipRow.tsx`:

```tsx
import { type HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

export interface ChipRowItem {
  label: string;
  href?: string;
}

export interface ChipRowProps extends HTMLAttributes<HTMLDivElement> {
  chips: ChipRowItem[];
}

const chipClass =
  'inline-flex items-center rounded-full border border-border bg-surface px-5 py-2.5 text-[13px] font-bold text-text transition-[background-color,color,border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-primary hover:bg-primary hover:text-on-primary';

export function ChipRow({ chips, className, ...props }: ChipRowProps) {
  return (
    <div className={cn('flex flex-wrap gap-2.5', className)} {...props}>
      {chips.map((chip) =>
        chip.href ? (
          <a key={chip.label} href={chip.href} className={chipClass}>
            {chip.label}
          </a>
        ) : (
          <span key={chip.label} className={chipClass}>
            {chip.label}
          </span>
        ),
      )}
    </div>
  );
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/components/ChipRow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Story + barrel + commit**

`src/components/ChipRow.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChipRow } from './ChipRow';

const meta: Meta<typeof ChipRow> = {
  title: 'Components/ChipRow',
  component: ChipRow,
  args: {
    chips: [
      { label: 'Apliques de pared', href: '/catalogo' },
      { label: 'Faroles solares', href: '/catalogo' },
      { label: 'Smart / Wi-Fi' },
    ],
  },
};
export default meta;
type Story = StoryObj<typeof ChipRow>;

export const Default: Story = {};
```

En `src/index.ts` (mismo estilo de línea que los demás):

```ts
export { ChipRow, type ChipRowProps, type ChipRowItem } from './components/ChipRow';
```

Run: `npm run typecheck && npm test` → PASS.

```bash
git add src/components/ChipRow.tsx src/components/ChipRow.test.tsx src/components/ChipRow.stories.tsx src/index.ts
git commit -m "feat(ChipRow): chips de categorías editorial"
```

---

### Task 5: `ServiceCard`

**Files:**
- Create: `src/components/ServiceCard.tsx`
- Test: `src/components/ServiceCard.test.tsx`
- Story: `src/components/ServiceCard.stories.tsx`

- [ ] **Step 1: Test que falla**

```tsx
import { render, screen } from '@testing-library/react';
import { ServiceCard } from './ServiceCard';

describe('ServiceCard', () => {
  it('renderiza título y texto', () => {
    render(<ServiceCard icon={<svg data-testid="ic" />} title="Envío gratis" text="En compras desde $100.000." />);
    expect(screen.getByText('Envío gratis')).toBeInTheDocument();
    expect(screen.getByText('En compras desde $100.000.')).toBeInTheDocument();
    expect(screen.getByTestId('ic')).toBeInTheDocument();
  });

  it('la card usa superficie y bordes redondeados editoriales', () => {
    render(<ServiceCard icon={null} title="Stock real" text="Sincronizado." />);
    const card = screen.getByText('Stock real').closest('div');
    expect(card?.className).toContain('rounded-[20px]');
    expect(card?.className).toContain('bg-surface');
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/components/ServiceCard.test.tsx` → FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

`src/components/ServiceCard.tsx`:

```tsx
import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface ServiceCardProps extends HTMLAttributes<HTMLDivElement> {
  icon: ReactNode;
  title: string;
  text: string;
}

export function ServiceCard({ icon, title, text, className, ...props }: ServiceCardProps) {
  return (
    <div
      className={cn(
        'rounded-[20px] border border-border/50 bg-surface p-6 transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-2',
        className,
      )}
      {...props}
    >
      <div className="mb-4 flex h-[46px] w-[46px] items-center justify-center rounded-[14px] bg-accent-soft text-accent-strong [&_svg]:h-[22px] [&_svg]:w-[22px]">
        {icon}
      </div>
      <b className="block text-[15px] font-extrabold text-text">{title}</b>
      <span className="mt-1.5 block text-[13px] leading-snug text-muted">{text}</span>
    </div>
  );
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/components/ServiceCard.test.tsx` → PASS.

- [ ] **Step 5: Story + barrel + commit**

`src/components/ServiceCard.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ServiceCard } from './ServiceCard';

const meta: Meta<typeof ServiceCard> = {
  title: 'Components/ServiceCard',
  component: ServiceCard,
  args: {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7h11v10H3zM14 10h4l3 3v4h-7z" />
        <circle cx="7" cy="17.5" r="1.6" />
        <circle cx="17" cy="17.5" r="1.6" />
      </svg>
    ),
    title: 'Envío gratis',
    text: 'En compras desde $100.000 a todo el país.',
  },
};
export default meta;
type Story = StoryObj<typeof ServiceCard>;

export const Default: Story = {};
```

En `src/index.ts`: `export { ServiceCard, type ServiceCardProps } from './components/ServiceCard';`

Run: `npm run typecheck && npm test` → PASS.

```bash
git add src/components/ServiceCard.tsx src/components/ServiceCard.test.tsx src/components/ServiceCard.stories.tsx src/index.ts
git commit -m "feat(ServiceCard): tarjeta de servicio editorial"
```

---

### Task 6: `Marquee`

**Files:**
- Create: `src/components/Marquee.tsx`
- Test: `src/components/Marquee.test.tsx`
- Story: `src/components/Marquee.stories.tsx`

- [ ] **Step 1: Test que falla**

```tsx
import { render, screen } from '@testing-library/react';
import { Marquee } from './Marquee';

describe('Marquee', () => {
  it('renderiza los items duplicados para el loop infinito', () => {
    render(<Marquee items={['Más de 5.000 productos', 'Despacho en 24 h']} />);
    expect(screen.getAllByText('Más de 5.000 productos').length).toBe(2);
    expect(screen.getAllByText('Despacho en 24 h').length).toBe(2);
  });

  it('usa la animación marquee y bordes de línea', () => {
    const { container } = render(<Marquee items={['x']} />);
    expect(container.querySelector('.animate-marquee')).not.toBeNull();
    expect(container.firstChild?.className).toContain('border-y');
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/components/Marquee.test.tsx` → FAIL.

- [ ] **Step 3: Implementar**

`src/components/Marquee.tsx`:

```tsx
import { type HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

export interface MarqueeProps extends HTMLAttributes<HTMLDivElement> {
  items: string[];
}

function Sparkle() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-[11px] w-[11px] text-accent" aria-hidden="true">
      <path d="M12 2c1.5 5.5 4.5 8.5 10 10-5.5 1.5-8.5 4.5-10 10-1.5-5.5-4.5-8.5-10-10 5.5-1.5 8.5-4.5 10-10z" />
    </svg>
  );
}

export function Marquee({ items, className, ...props }: MarqueeProps) {
  return (
    <div
      className={cn('overflow-hidden whitespace-nowrap border-y border-border py-4', className)}
      aria-hidden="true"
      {...props}
    >
      <div className="inline-flex animate-marquee">
        {[0, 1].map((copy) => (
          <div key={copy} className="inline-flex items-center" aria-hidden={copy === 1}>
            {items.map((item) => (
              <span
                key={`${copy}-${item}`}
                className="inline-flex items-center gap-7 px-4 font-display text-[15px] italic text-muted"
              >
                {item}
                <Sparkle />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/components/Marquee.test.tsx` → PASS.

- [ ] **Step 5: Story + barrel + commit**

`src/components/Marquee.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Marquee } from './Marquee';

const meta: Meta<typeof Marquee> = {
  title: 'Components/Marquee',
  component: Marquee,
  args: { items: ['Más de 5.000 productos', 'Despacho en 24 h', 'Precios mayoristas', 'Puerto Iguazú, Misiones'] },
};
export default meta;
type Story = StoryObj<typeof Marquee>;

export const Default: Story = {};
```

En `src/index.ts`: `export { Marquee, type MarqueeProps } from './components/Marquee';`

Run: `npm run typecheck && npm test` → PASS.

```bash
git add src/components/Marquee.tsx src/components/Marquee.test.tsx src/components/Marquee.stories.tsx src/index.ts
git commit -m "feat(Marquee): ticker infinito editorial"
```

---

### Task 7: `Hero`

**Files:**
- Create: `src/components/Hero.tsx`
- Test: `src/components/Hero.test.tsx`
- Story: `src/components/Hero.stories.tsx`

- [ ] **Step 1: Test que falla**

```tsx
import { render, screen } from '@testing-library/react';
import { Hero } from './Hero';

describe('Hero', () => {
  it('renderiza eyebrow, título y acento en itálica', () => {
    render(<Hero eyebrow="Nueva colección 2026" title="La luz que hace" accent="hogar" imageSrc="/hero.jpg" />);
    expect(screen.getByText('Nueva colección 2026')).toBeInTheDocument();
    const titulo = screen.getByRole('heading', { level: 1 });
    expect(titulo).toHaveTextContent('La luz que hace');
    expect(titulo.querySelector('em')?.textContent).toBe('hogar');
  });

  it('renderiza imagen con alt y CTAs como links', () => {
    render(
      <Hero
        eyebrow="e"
        title="t"
        imageSrc="/hero.jpg"
        imageAlt="Living cálido"
        ctas={[{ label: 'Ver catálogo →', href: '/catalogo' }, { label: 'Línea decorativa', href: '/deco' }]}
        usps={[{ label: 'Envíos a todo el país' }]}
      />,
    );
    expect(screen.getByAltText('Living cálido')).toHaveAttribute('src', '/hero.jpg');
    expect(screen.getByRole('link', { name: 'Ver catálogo →' })).toHaveAttribute('href', '/catalogo');
    expect(screen.getByRole('link', { name: 'Línea decorativa' })).toHaveAttribute('href', '/deco');
    expect(screen.getByText('Envíos a todo el país')).toBeInTheDocument();
  });

  it('usa el frame editorial redondeado', () => {
    const { container } = render(<Hero eyebrow="e" title="t" imageSrc="/h.jpg" />);
    expect(container.querySelector('section')?.className).toContain('rounded-[28px]');
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/components/Hero.test.tsx` → FAIL.

- [ ] **Step 3: Implementar**

`src/components/Hero.tsx`:

```tsx
import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface HeroCta {
  label: string;
  href: string;
}

export interface HeroUsp {
  icon?: ReactNode;
  label: string;
}

export interface HeroProps extends HTMLAttributes<HTMLElement> {
  eyebrow: string;
  title: string;
  /** Palabra final en itálica ámbar (ej. "hogar"). */
  accent?: string;
  lead?: string;
  imageSrc: string;
  imageAlt?: string;
  ctas?: HeroCta[];
  usps?: HeroUsp[];
}

export function Hero({ eyebrow, title, accent, lead, imageSrc, imageAlt = '', ctas, usps, className, ...props }: HeroProps) {
  return (
    <section
      className={cn(
        'relative isolate flex min-h-[clamp(480px,72vh,680px)] items-center overflow-hidden rounded-[28px] shadow-2',
        className,
      )}
      {...props}
    >
      {/* El velo degradado va de crema sólida a transparente: el texto va a la
          izquierda sobre fondo claro y la foto respira a la derecha. */}
      <img src={imageSrc} alt={imageAlt} className="absolute inset-0 -z-20 h-full w-full object-cover" />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(100deg,rgba(247,242,234,0.94)_0%,rgba(247,242,234,0.82)_34%,rgba(247,242,234,0.25)_62%,transparent_80%)]" />
      <div className="relative max-w-[600px] p-[clamp(28px,5vw,72px)]">
        <span className="mb-5 inline-flex items-center gap-2.5 text-[11px] font-extrabold uppercase tracking-[0.22em] text-accent-strong before:h-[1.5px] before:w-[26px] before:bg-accent-strong before:content-['']">
          {eyebrow}
        </span>
        <h1 className="font-display text-[clamp(38px,4.6vw,64px)] font-medium leading-[1.06] tracking-tight text-text">
          {title}
          {accent ? <em className="italic text-accent"> {accent}</em> : null}
        </h1>
        {lead ? <p className="mt-5 max-w-[42ch] text-[clamp(15px,1.35vw,17.5px)] leading-[1.65] text-muted">{lead}</p> : null}
        {ctas && ctas.length > 0 ? (
          <div className="mt-8 flex flex-wrap gap-3.5">
            {ctas.map((cta, i) => (
              <a
                key={cta.href + cta.label}
                href={cta.href}
                className={
                  i === 0
                    ? 'inline-flex items-center gap-2.5 rounded-full bg-primary px-[30px] py-4 text-sm font-extrabold text-on-primary transition-[background-color,color,transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:bg-accent hover:text-white'
                    : 'inline-flex items-center gap-2.5 rounded-full border-[1.5px] border-primary px-[30px] py-4 text-sm font-extrabold text-primary transition-[border-color,color,transform] duration-150 hover:-translate-y-0.5 hover:border-accent hover:text-accent'
                }
              >
                {cta.label}
              </a>
            ))}
          </div>
        ) : null}
        {usps && usps.length > 0 ? (
          <div className="mt-9 flex flex-wrap gap-8 text-[13px] font-bold text-muted [&_svg]:h-[17px] [&_svg]:w-[17px] [&_svg]:text-accent">
            {usps.map((usp) => (
              <span key={usp.label} className="inline-flex items-center gap-2.5">
                {usp.icon}
                {usp.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/components/Hero.test.tsx` → PASS.

- [ ] **Step 5: Story + barrel + commit**

`src/components/Hero.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Hero } from './Hero';

const meta: Meta<typeof Hero> = {
  title: 'Components/Hero',
  component: Hero,
  args: {
    eyebrow: 'Nueva colección 2026',
    title: 'La luz que hace',
    accent: 'hogar',
    lead: 'Lámparas, colgantes, guirnaldas y todo para iluminar tu casa. Stock real, marcas líderes y precios para todos.',
    imageSrc: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=1600&q=80',
    imageAlt: 'Living cálido',
    ctas: [{ label: 'Ver catálogo →', href: '/catalogo' }, { label: 'Línea decorativa', href: '/deco' }],
    usps: [{ label: 'Envíos a todo el país' }, { label: 'Stock en tiempo real' }, { label: 'Asesoramiento por WhatsApp' }],
  },
};
export default meta;
type Story = StoryObj<typeof Hero>;

export const Default: Story = {};
```

En `src/index.ts`: `export { Hero, type HeroProps, type HeroCta, type HeroUsp } from './components/Hero';`

Run: `npm run typecheck && npm test` → PASS.

```bash
git add src/components/Hero.tsx src/components/Hero.test.tsx src/components/Hero.stories.tsx src/index.ts
git commit -m "feat(Hero): hero editorial con velo crema y CTAs pill"
```

---

### Task 8: `RoomTiles` (ambientes / deco grid)

**Files:**
- Create: `src/components/RoomTiles.tsx`
- Test: `src/components/RoomTiles.test.tsx`
- Story: `src/components/RoomTiles.stories.tsx`

- [ ] **Step 1: Test que falla**

```tsx
import { render, screen } from '@testing-library/react';
import { RoomTiles } from './RoomTiles';

const items = [
  { eyebrow: 'Interior', title: 'Colgantes y lámparas', imageSrc: '/a.jpg', href: '/c1' },
  { eyebrow: 'Exterior', title: 'Patio y jardín', imageSrc: '/b.jpg', href: '/c2' },
  { eyebrow: 'Interior', title: 'Dormitorio', imageSrc: '/c.jpg', href: '/c3' },
];

describe('RoomTiles', () => {
  it('renderiza todos los tiles como links con su caption', () => {
    render(<RoomTiles items={items} />);
    for (const it of items) {
      expect(screen.getByRole('link', { name: new RegExp(it.title) })).toHaveAttribute('href', it.href);
    }
  });

  it('mosaic: el primer tile ocupa las dos filas (grilla 1.25fr/1fr)', () => {
    render(<RoomTiles items={items} />);
    const first = screen.getByRole('link', { name: /Colgantes/ });
    expect(first.className).toContain('lg:row-span-2');
    expect(first.className).toContain('lg:min-h-[460px]');
  });

  it('grid: tiles uniformes de 4 columnas con flecha circular', () => {
    render(<RoomTiles items={items} variant="grid" />);
    const first = screen.getByRole('link', { name: /Colgantes/ });
    expect(first.className).toContain('lg:min-h-0');
    expect(first.querySelector('[data-go]')).not.toBeNull();
  });

  it('mosaic usa el link "Explorar →"', () => {
    render(<RoomTiles items={items} />);
    expect(screen.getAllByText('Explorar →').length).toBe(3);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/components/RoomTiles.test.tsx` → FAIL.

- [ ] **Step 3: Implementar**

`src/components/RoomTiles.tsx`:

```tsx
import { type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

export interface RoomTile {
  eyebrow: string;
  title: string;
  imageSrc: string;
  imageAlt?: string;
  href: string;
}

const tile = cva(
  'group relative isolate flex items-end overflow-hidden rounded-[24px]',
  {
    variants: {
      variant: {
        mosaic: 'min-h-[300px] lg:min-h-[220px]',
        grid: 'min-h-[240px] lg:min-h-0 lg:aspect-[1/1.25]',
      },
    },
    defaultVariants: { variant: 'mosaic' },
  },
);

export interface RoomTilesProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof tile> {
  items: RoomTile[];
}

export function RoomTiles({ items, variant, className, ...props }: RoomTilesProps) {
  const esMosaic = variant !== 'grid';
  return (
    <div
      className={cn(
        'grid gap-5',
        esMosaic ? 'lg:grid-cols-[1.25fr_1fr]' : 'grid-cols-2 lg:grid-cols-4',
        className,
      )}
      {...props}
    >
      {items.map((item, i) => (
        <a
          key={item.href + item.title}
          href={item.href}
          data-size={i === 0 && esMosaic ? 'big' : undefined}
          className={cn(
            tile({ variant }),
            i === 0 && esMosaic && 'lg:row-span-2 lg:min-h-[460px]',
          )}
        >
          <img
            src={item.imageSrc}
            alt={item.imageAlt ?? ''}
            className="absolute inset-0 -z-20 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.045]"
          />
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_top,rgba(30,22,14,0.62)_0%,rgba(30,22,14,0.12)_45%,transparent_70%)]" />
          <div className="p-[clamp(22px,2.5vw,34px)]">
            <small className="mb-2 block text-[11px] font-extrabold uppercase tracking-[0.2em] text-highlight">
              {item.eyebrow}
            </small>
            <h3 className="font-display text-[clamp(24px,2.4vw,34px)] font-medium leading-[1.1] text-white">
              {item.title}
            </h3>
            {esMosaic ? (
              <span className="mt-3.5 inline-flex items-center gap-2 border-b-[1.5px] border-white/50 pb-[3px] text-[13px] font-extrabold text-white transition-[border-color,gap] duration-200 group-hover:border-highlight group-hover:gap-3">
                Explorar →
              </span>
            ) : null}
          </div>
          {!esMosaic ? (
            <span
              data-go
              className="absolute bottom-5 right-5 flex h-[34px] w-[34px] items-center justify-center rounded-full bg-surface text-base text-text transition-[background-color,transform] duration-300 group-hover:-rotate-45 group-hover:bg-highlight"
              aria-hidden="true"
            >
              →
            </span>
          ) : null}
        </a>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/components/RoomTiles.test.tsx` → PASS.

- [ ] **Step 5: Story + barrel + commit**

`src/components/RoomTiles.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { RoomTiles } from './RoomTiles';

const items = [
  { eyebrow: 'Interior', title: 'Colgantes y lámparas de diseño', imageSrc: 'https://images.unsplash.com/photo-1565538810643-b5bdb714032a?w=1200&q=80', href: '#' },
  { eyebrow: 'Exterior', title: 'Patio y jardín', imageSrc: 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=800&q=80', href: '#' },
  { eyebrow: 'Interior', title: 'Dormitorio', imageSrc: 'https://images.unsplash.com/photo-1540518614846-7eded433c457?w=800&q=80', href: '#' },
];

const meta: Meta<typeof RoomTiles> = {
  title: 'Components/RoomTiles',
  component: RoomTiles,
  args: { items },
};
export default meta;
type Story = StoryObj<typeof RoomTiles>;

export const Mosaic: Story = {};
export const Grid: Story = { args: { variant: 'grid' } };
```

En `src/index.ts`: `export { RoomTiles, type RoomTilesProps, type RoomTile } from './components/RoomTiles';`

Run: `npm run typecheck && npm test` → PASS.

```bash
git add src/components/RoomTiles.tsx src/components/RoomTiles.test.tsx src/components/RoomTiles.stories.tsx src/index.ts
git commit -m "feat(RoomTiles): tiles de ambientes (mosaic) y deco (grid)"
```

---

### Task 9: `PromoBanner`

**Files:**
- Create: `src/components/PromoBanner.tsx`
- Test: `src/components/PromoBanner.test.tsx`
- Story: `src/components/PromoBanner.stories.tsx`

- [ ] **Step 1: Test que falla**

```tsx
import { render, screen } from '@testing-library/react';
import { PromoBanner } from './PromoBanner';

describe('PromoBanner', () => {
  it('renderiza eyebrow, título con acento y CTA claro', () => {
    render(
      <PromoBanner
        eyebrow="Línea decorativa · Nuevo"
        title="Ambientá tus noches con"
        accent="luz cálida"
        lead="Guirnaldas, neones, veladores y colgantes."
        cta={{ label: 'Descubrir la línea →', href: '/deco' }}
        imageSrc="/deco.jpg"
      />,
    );
    expect(screen.getByText('Línea decorativa · Nuevo')).toBeInTheDocument();
    const h2 = screen.getByRole('heading', { level: 2 });
    expect(h2.querySelector('em')?.textContent).toBe('luz cálida');
    const cta = screen.getByRole('link', { name: 'Descubrir la línea →' });
    expect(cta).toHaveAttribute('href', '/deco');
    expect(cta.className).toContain('bg-surface');
  });

  it('el banner es redondeado y lleva overlay oscuro', () => {
    const { container } = render(<PromoBanner eyebrow="e" title="t" imageSrc="/d.jpg" />);
    const section = container.querySelector('section');
    expect(section?.className).toContain('rounded-[28px]');
    expect(section?.querySelector('img')?.className).toContain('object-cover');
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/components/PromoBanner.test.tsx` → FAIL.

- [ ] **Step 3: Implementar**

`src/components/PromoBanner.tsx`:

```tsx
import { type HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

export interface PromoBannerProps extends HTMLAttributes<HTMLElement> {
  eyebrow: string;
  title: string;
  /** Frase final en itálica dorada (ej. "luz cálida"). */
  accent?: string;
  lead?: string;
  cta?: { label: string; href: string };
  imageSrc: string;
  imageAlt?: string;
}

export function PromoBanner({ eyebrow, title, accent, lead, cta, imageSrc, imageAlt = '', className, ...props }: PromoBannerProps) {
  return (
    <section
      className={cn('relative isolate flex min-h-[420px] items-center overflow-hidden rounded-[28px] shadow-2', className)}
      {...props}
    >
      <img src={imageSrc} alt={imageAlt} className="absolute inset-0 -z-20 h-full w-full object-cover" />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(95deg,rgba(24,17,10,0.78)_0%,rgba(24,17,10,0.45)_45%,transparent_75%)]" />
      <div className="max-w-[560px] p-[clamp(30px,5vw,72px)]">
        <span className="mb-4 inline-flex items-center gap-2.5 text-[11px] font-extrabold uppercase tracking-[0.22em] text-highlight before:h-[1.5px] before:w-[26px] before:bg-highlight before:content-['']">
          {eyebrow}
        </span>
        <h2 className="font-display text-[clamp(30px,3.6vw,50px)] font-medium leading-[1.08] text-white">
          {title}
          {accent ? <em className="italic text-highlight"> {accent}</em> : null}
        </h2>
        {lead ? <p className="mt-4 max-w-[44ch] text-[15.5px] leading-[1.65] text-white/80">{lead}</p> : null}
        {cta ? (
          <a
            href={cta.href}
            className="mt-6 inline-flex items-center gap-2.5 rounded-full bg-surface px-[30px] py-4 text-sm font-extrabold text-text transition-[background-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-highlight"
          >
            {cta.label}
          </a>
        ) : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/components/PromoBanner.test.tsx` → PASS.

- [ ] **Step 5: Story + barrel + commit**

`src/components/PromoBanner.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { PromoBanner } from './PromoBanner';

const meta: Meta<typeof PromoBanner> = {
  title: 'Components/PromoBanner',
  component: PromoBanner,
  args: {
    eyebrow: 'Línea decorativa · Nuevo',
    title: 'Ambientá tus noches con',
    accent: 'luz cálida',
    lead: 'Guirnaldas, neones, veladores y colgantes para transformar cualquier espacio.',
    cta: { label: 'Descubrir la línea →', href: '/deco' },
    imageSrc: 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=1600&q=80',
    imageAlt: 'Patio con guirnaldas al atardecer',
  },
};
export default meta;
type Story = StoryObj<typeof PromoBanner>;

export const Default: Story = {};
```

En `src/index.ts`: `export { PromoBanner, type PromoBannerProps } from './components/PromoBanner';`

Run: `npm run typecheck && npm test` → PASS.

```bash
git add src/components/PromoBanner.tsx src/components/PromoBanner.test.tsx src/components/PromoBanner.stories.tsx src/index.ts
git commit -m "feat(PromoBanner): banner editorial con overlay oscuro"
```

---

### Task 10: `SiteHeader`

**Files:**
- Create: `src/components/SiteHeader.tsx`
- Test: `src/components/SiteHeader.test.tsx`
- Story: `src/components/SiteHeader.stories.tsx`

- [ ] **Step 1: Test que falla**

```tsx
import { render, screen } from '@testing-library/react';
import { SiteHeader } from './SiteHeader';

describe('SiteHeader', () => {
  it('renderiza marca con acento itálico y descriptor', () => {
    render(<SiteHeader brandName="Central" brandAccent="Led" brandSub="Iluminación · Electricidad" />);
    const marca = screen.getByRole('link', { name: /central/i });
    expect(marca.querySelector('em')?.textContent).toBe('Led');
    expect(screen.getByText('Iluminación · Electricidad')).toBeInTheDocument();
  });

  it('renderiza nav con badge cuando el item la tiene', () => {
    render(
      <SiteHeader
        brandName="Central"
        brandSub="s"
        nav={[{ label: 'Iluminación', href: '/ilum' }, { label: 'Decorativa', href: '/deco', badge: 'Nuevo' }]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Iluminación' })).toHaveAttribute('href', '/ilum');
    expect(screen.getByText('Nuevo')).toBeInTheDocument();
  });

  it('las slots search y actions se renderizan en su zona', () => {
    render(
      <SiteHeader
        brandName="Central"
        brandSub="s"
        search={<input aria-label="buscar" />}
        actions={<a href="/carrito">Carrito</a>}
        nav={[{ label: 'Ofertas', href: '/ofertas' }]}
      />,
    );
    expect(screen.getByLabelText('buscar')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Carrito' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ofertas' })).toBeInTheDocument();
  });

  it('es sticky y usa fondo translúcido', () => {
    const { container } = render(<SiteHeader brandName="Central" brandSub="s" />);
    expect(container.querySelector('header')?.className).toContain('sticky');
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/components/SiteHeader.test.tsx` → FAIL.

- [ ] **Step 3: Implementar**

`src/components/SiteHeader.tsx`:

```tsx
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface SiteNavItem {
  label: string;
  href: string;
  badge?: string;
}

export interface SiteHeaderProps extends HTMLAttributes<HTMLElement> {
  brandName: string;
  /** Segunda palabra de la marca, en itálica ámbar (ej. "Led"). */
  brandAccent?: string;
  /** Descriptor chico en small caps bajo la marca. */
  brandSub: string;
  /** Zona de búsqueda (slot): el consumidor pasa su autocomplete. */
  search?: ReactNode;
  /** Zona de acciones (slot): cuenta, carrito, etc. */
  actions?: ReactNode;
  nav?: SiteNavItem[];
}

export const SiteHeader = forwardRef<HTMLElement, SiteHeaderProps>(
  ({ brandName, brandAccent, brandSub, search, actions, nav, className, ...props }, ref) => (
    <header ref={ref} className={cn('sticky top-0 z-50 border-b border-border bg-bg/90 backdrop-blur-md', className)} {...props}>
      <div className="mx-auto grid h-[78px] max-w-[1280px] grid-cols-[1fr_auto_1fr] items-center gap-5 px-[clamp(18px,4vw,48px)] max-lg:h-auto max-lg:grid-cols-1 max-lg:py-3.5">
        <div className="flex max-lg:order-2 max-lg:w-full max-lg:col-span-full">{search}</div>
        <a href="/" className="text-center leading-none max-lg:order-1 max-lg:text-left">
          <span className="font-display text-[26px] font-semibold tracking-tight text-text">
            {brandName}
            {brandAccent ? <em className="italic text-accent"> {brandAccent}</em> : null}
          </span>
          <span className="mt-[5px] block text-[9.5px] font-bold uppercase tracking-[0.32em] text-muted">
            {brandSub}
          </span>
        </a>
        <div className="flex items-center justify-end gap-6 text-[13.5px] font-bold text-text max-lg:order-3">
          {actions}
        </div>
      </div>
      {nav && nav.length > 0 ? (
        <nav className="border-t border-border">
          <div className="no-scrollbar mx-auto flex h-[52px] max-w-[1280px] items-center justify-center gap-[clamp(18px,3.5vw,44px)] overflow-x-auto px-[clamp(18px,4vw,48px)] max-lg:justify-start">
            {nav.map((item) => (
              <a
                key={item.label + item.href}
                href={item.href}
                className="relative shrink-0 py-1.5 text-[13.5px] font-bold text-text transition-colors after:absolute after:bottom-0 after:left-0 after:h-[2px] after:w-full after:origin-left after:scale-x-0 after:rounded-sm after:bg-accent after:transition-transform after:duration-200 hover:text-accent hover:after:scale-x-100"
              >
                {item.label}
                {item.badge ? (
                  <span className="ml-1.5 rounded-full bg-accent-soft px-2.5 py-[3px] align-middle text-[10px] font-extrabold uppercase tracking-wider text-accent-strong">
                    {item.badge}
                  </span>
                ) : null}
              </a>
            ))}
          </div>
        </nav>
      ) : null}
    </header>
  ),
);
SiteHeader.displayName = 'SiteHeader';
```

Nota: usa la utilidad `no-scrollbar`... NO — el DS no exporta esa utilidad (vive en el shop). Usar solo `overflow-x-auto` y dejar el scrollbar: reemplazar `no-scrollbar` por nada. (En el plan del shop se puede re-agregar.)

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/components/SiteHeader.test.tsx` → PASS.

- [ ] **Step 5: Story + barrel + commit**

`src/components/SiteHeader.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SiteHeader } from './SiteHeader';

const meta: Meta<typeof SiteHeader> = {
  title: 'Components/SiteHeader',
  component: SiteHeader,
  args: {
    brandName: 'Central',
    brandAccent: 'Led',
    brandSub: 'Iluminación · Electricidad',
    search: <input placeholder="¿Qué estás buscando?" aria-label="buscar" className="w-full rounded-full border border-border bg-surface px-4 py-2.5 text-sm" />,
    actions: <a href="/carrito">Carrito</a>,
    nav: [
      { label: 'Novedades', href: '#' },
      { label: 'Iluminación', href: '#' },
      { label: 'Decorativa', href: '#', badge: 'Nuevo' },
      { label: 'Exterior', href: '#' },
      { label: 'Ofertas', href: '#' },
    ],
  },
};
export default meta;
type Story = StoryObj<typeof SiteHeader>;

export const Default: Story = {};
```

En `src/index.ts`: `export { SiteHeader, type SiteHeaderProps, type SiteNavItem } from './components/SiteHeader';`

Run: `npm run typecheck && npm test` → PASS.

```bash
git add src/components/SiteHeader.tsx src/components/SiteHeader.test.tsx src/components/SiteHeader.stories.tsx src/index.ts
git commit -m "feat(SiteHeader): header editorial con slots y nav con badge"
```

---

### Task 11: `SiteFooter`

**Files:**
- Create: `src/components/SiteFooter.tsx`
- Test: `src/components/SiteFooter.test.tsx`
- Story: `src/components/SiteFooter.stories.tsx`

- [ ] **Step 1: Test que falla**

```tsx
import { render, screen } from '@testing-library/react';
import { SiteFooter } from './SiteFooter';

const columns = [
  { title: 'Rubros', links: [{ label: 'Iluminación LED', href: '/c1' }, { label: 'Tableros', href: '/c2' }] },
  { title: 'Mi cuenta', links: [{ label: 'Mis pedidos', href: '/m1' }] },
];

describe('SiteFooter', () => {
  it('renderiza marca, descripción y columnas con links', () => {
    render(
      <SiteFooter
        brandName="Central"
        brandAccent="Led"
        description="Materiales eléctricos en Puerto Iguazú."
        columns={columns}
        barLeft="© 2026 Central Led"
        barRight="Hecho con luz en Misiones"
      />,
    );
    expect(screen.getByText('Materiales eléctricos en Puerto Iguazú.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Iluminación LED' })).toHaveAttribute('href', '/c1');
    expect(screen.getByRole('heading', { name: 'Mi cuenta' })).toBeInTheDocument();
    expect(screen.getByText('Hecho con luz en Misiones')).toBeInTheDocument();
  });

  it('usa fondo primario (tinta) y esquinas superiores redondeadas', () => {
    const { container } = render(
      <SiteFooter brandName="Central" description="d" columns={[]} barLeft="l" />,
    );
    const footer = container.querySelector('footer');
    expect(footer?.className).toContain('bg-primary');
    expect(footer?.className).toContain('rounded-t-[32px]');
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/components/SiteFooter.test.tsx` → FAIL.

- [ ] **Step 3: Implementar**

`src/components/SiteFooter.tsx`:

```tsx
import { type HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

export interface SiteFooterLink {
  label: string;
  href: string;
}

export interface SiteFooterColumn {
  title: string;
  links: SiteFooterLink[];
}

export interface SiteFooterProps extends HTMLAttributes<HTMLElement> {
  brandName: string;
  brandAccent?: string;
  description: string;
  columns: SiteFooterColumn[];
  barLeft?: string;
  barRight?: string;
}

export function SiteFooter({ brandName, brandAccent, description, columns, barLeft, barRight, className, ...props }: SiteFooterProps) {
  return (
    <footer className={cn('mt-2 rounded-t-[32px] bg-primary text-on-primary', className)} {...props}>
      <div className="mx-auto grid max-w-[1280px] gap-9 px-[clamp(18px,4vw,48px)] py-[clamp(48px,6vw,80px)] lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div>
          <span className="font-display text-3xl font-semibold">
            {brandName}
            {brandAccent ? <em className="italic text-highlight"> {brandAccent}</em> : null}
          </span>
          <p className="mt-4 max-w-[34ch] text-sm leading-[1.7] text-on-primary/60">{description}</p>
        </div>
        {columns.map((col) => (
          <div key={col.title}>
            <h5 className="mb-4 text-[11px] font-extrabold uppercase tracking-[0.22em] text-on-primary/45">
              {col.title}
            </h5>
            {col.links.map((link) => (
              <a
                key={link.label + link.href}
                href={link.href}
                className="block py-1.5 text-[14.5px] font-semibold text-on-primary/85 transition-[color,padding-left] duration-150 hover:pl-1.5 hover:text-highlight"
              >
                {link.label}
              </a>
            ))}
          </div>
        ))}
      </div>
      {barLeft || barRight ? (
        <div className="border-t border-on-primary/15">
          <div className="mx-auto flex max-w-[1280px] flex-wrap justify-between gap-4 px-[clamp(18px,4vw,48px)] py-5 text-xs font-semibold text-on-primary/45">
            <span>{barLeft}</span>
            <span>{barRight}</span>
          </div>
        </div>
      ) : null}
    </footer>
  );
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/components/SiteFooter.test.tsx` → PASS.

- [ ] **Step 5: Story + barrel + commit**

`src/components/SiteFooter.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SiteFooter } from './SiteFooter';

const meta: Meta<typeof SiteFooter> = {
  title: 'Components/SiteFooter',
  component: SiteFooter,
  args: {
    brandName: 'Central',
    brandAccent: 'Led',
    description: 'Materiales eléctricos e iluminación en Puerto Iguazú, Misiones. Venta mayorista y minorista con amor por la luz.',
    columns: [
      { title: 'Rubros', links: [{ label: 'Iluminación LED', href: '#' }, { label: 'Línea decorativa', href: '#' }, { label: 'Electricidad', href: '#' }] },
      { title: 'Mi cuenta', links: [{ label: 'Mis pedidos', href: '#' }, { label: 'Facturas', href: '#'}] },
      { title: 'Contacto', links: [{ label: 'WhatsApp', href: '#' }, { label: 'Ubicación', href: '#' }] },
    ],
    barLeft: '© 2026 Central Led — Puerto Iguazú, Misiones',
    barRight: 'Hecho con luz en Misiones',
  },
};
export default meta;
type Story = StoryObj<typeof SiteFooter>;

export const Default: Story = {};
```

En `src/index.ts`: `export { SiteFooter, type SiteFooterProps, type SiteFooterColumn, type SiteFooterLink } from './components/SiteFooter';`

Run: `npm run typecheck && npm test` → PASS.

```bash
git add src/components/SiteFooter.tsx src/components/SiteFooter.test.tsx src/components/SiteFooter.stories.tsx src/index.ts
git commit -m "feat(SiteFooter): footer editorial tinta con columnas"
```

---

### Task 12: Verificación final + release 0.11.0

**Files:**
- Modify: `package.json` (version)

- [ ] **Step 1: Chequeo completo**

Run: `npm run typecheck && npm test && npm run build && npm run build-storybook`
Expected: todo verde. El build de storybook valida que ninguna story rompa.

- [ ] **Step 2: Verificar el barrel público**

Abrir `src/index.ts` y confirmar que se exportan: `ChipRow`, `ServiceCard`, `Marquee`, `Hero`, `RoomTiles`, `PromoBanner`, `SiteHeader`, `SiteFooter`, `ProductCardVariant` (además de lo existente, intacto).

- [ ] **Step 3: Bump de versión**

En `package.json` cambiar `"version": "0.10.0"` → `"version": "0.11.0"`.

- [ ] **Step 4: Commit de release + merge a main**

```bash
git add package.json
git commit -m "chore(release): 0.11.0"
git checkout main
git merge --no-ff feat/editorial-theme -m "feat(theme): tema editorial + componentes site (0.11.0)"
git push origin main
```

- [ ] **Step 5: Publicar (acción manual en GitHub)**

En GitHub: Actions → workflow **publish** → **Run workflow** (con `dry_run: true` primero para verificar, luego de nuevo con `dry_run: false`). El workflow publica a GitHub Packages y crea el tag `v0.11.0`. Verificar en la pestaña Packages del org que `@myd-org/ui@0.11.0` aparece.

- [ ] **Step 6: Comunicar**

Avisar que el plan del shop (docs/superpowers/plans/2026-09-18-shop-rediseno-editorial.md en el repo Shop) puede arrancar: el consumidor instalara `@myd-org/ui@^0.11.0`.
