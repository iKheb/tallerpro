/**
 * Marca TallerPro — fuente única del isotipo (lo usan el Shell, el onboarding,
 * las texturas 3D y los íconos PWA). Concepto: una tuerca hexagonal (el taller)
 * que guarda un celular con la palomita de "reparado".
 *
 * Este archivo no importa nada: `src/pwa/tools/gen-icons.mjs` lo transpila suelto.
 */
export const BRAND_NAME = 'TallerPro';
export const BRAND_TAGLINE = 'Gestión para tu servicio técnico';

/** Colores del degradado del isotipo (de arriba-izquierda a abajo-derecha). */
export const BRAND_GRADIENT = ['#8b7bff', '#5b8cff', '#22d3ee'] as const;

type Pt = readonly [number, number];

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Vértices de un hexágono con punta arriba, de radio `R`, centrado en (32,32), en sentido horario. */
function hexPoints(R: number): Pt[] {
  return Array.from({ length: 6 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    return [r2(32 + R * Math.cos(a)), r2(32 + R * Math.sin(a))] as const;
  });
}

/** Geometría del isotipo en un viewBox 0 0 64 64. */
export const MARK = {
  viewBox: '0 0 64 64',
  /** Silueta de la tuerca (fondo con degradado). */
  hex: { points: hexPoints(31), r: 7 },
  /** Contorno de tuerca para las versiones sin silueta (maskable, badge, grabados). */
  ring: { points: hexPoints(27.5), r: 5, stroke: 3 },
  phone: { x: 21.5, y: 15, w: 21, h: 34, r: 5.5, stroke: 3.2 },
  speaker: { x1: 29, y1: 20.5, x2: 35, y2: 20.5 },
  /** Palomita de "reparado" (es el trazo que se anima). */
  check: '26.4,33.4 30.4,37.4 37.6,29.2',
} as const;

export interface RoundedCorner {
  /** Punto de entrada al arco (sobre la arista anterior). */
  a: Pt;
  /** Vértice del polígono (control del arco). */
  p: Pt;
  /** Punto de salida del arco (sobre la arista siguiente). */
  b: Pt;
}

/** Esquinas redondeadas de un polígono convexo (radio `r`): sirven para SVG y para canvas (arcTo). */
export function roundedCorners(points: readonly Pt[], r: number): RoundedCorner[] {
  const n = points.length;
  return points.map((p, i) => {
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const v1 = [prev[0] - p[0], prev[1] - p[1]];
    const v2 = [next[0] - p[0], next[1] - p[1]];
    const l1 = Math.hypot(v1[0], v1[1]);
    const l2 = Math.hypot(v2[0], v2[1]);
    const angle = Math.acos((v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2));
    const t = r / Math.tan(angle / 2);
    return {
      a: [r2(p[0] + (v1[0] / l1) * t), r2(p[1] + (v1[1] / l1) * t)],
      p,
      b: [r2(p[0] + (v2[0] / l2) * t), r2(p[1] + (v2[1] / l2) * t)],
    };
  });
}

/** Trazo SVG (`d`) de un polígono convexo en sentido horario con esquinas redondeadas. */
export function roundedPolygonPath(points: readonly Pt[], r: number): string {
  const corners = roundedCorners(points, r);
  return (
    corners.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.a[0]} ${c.a[1]} A${r} ${r} 0 0 1 ${c.b[0]} ${c.b[1]}`).join(' ') + ' Z'
  );
}

export const HEX_PATH = roundedPolygonPath(MARK.hex.points, MARK.hex.r);
export const RING_PATH = roundedPolygonPath(MARK.ring.points, MARK.ring.r);

/**
 * Glifo blanco (o del color dado) en coordenadas 0..64: celular + bocina + palomita.
 * Con `ring`, añade el contorno de la tuerca (para fondos sin silueta hexagonal).
 */
export function brandGlyphSVG(color = '#fff', ring = false): string {
  const { phone: p, speaker: s } = MARK;
  return `${ring ? `<path d="${RING_PATH}" fill="none" stroke="${color}" stroke-width="${MARK.ring.stroke}" stroke-linejoin="round"/>` : ''}
  <rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${p.r}" fill="none" stroke="${color}" stroke-width="${p.stroke}"/>
  <line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>
  <polyline points="${MARK.check}" fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** SVG completo del ícono (para favicon / íconos PWA). */
export function brandMarkSVG(size = 512): string {
  const [a, b, c] = BRAND_GRADIENT;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${a}"/><stop offset=".5" stop-color="${b}"/><stop offset="1" stop-color="${c}"/>
    </linearGradient>
    <radialGradient id="h" cx="20" cy="8" r="48" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <path d="${HEX_PATH}" fill="url(#g)"/>
  <path d="${HEX_PATH}" fill="url(#h)"/>
  ${brandGlyphSVG('#fff')}
</svg>`;
}
