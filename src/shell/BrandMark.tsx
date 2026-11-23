import { useId } from 'react';
import { BRAND_GRADIENT, HEX_PATH, MARK } from '@/app/brand';

export interface BrandMarkProps {
  size?: number;
  className?: string;
  /** Anima el trazo de la palomita (splash). */
  animated?: boolean;
  title?: string;
}

/** Isotipo de TallerPro (tuerca hexagonal con celular reparado) como SVG con degradado de marca. */
export function BrandMark({ size = 28, className, animated, title }: BrandMarkProps) {
  const uid = useId().replace(/:/g, '');
  const [a, b, c] = BRAND_GRADIENT;
  const { phone: p, speaker: s } = MARK;
  return (
    <svg width={size} height={size} viewBox={MARK.viewBox} className={className} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <linearGradient id={`g${uid}`} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={a} />
          <stop offset=".5" stopColor={b} />
          <stop offset="1" stopColor={c} />
        </linearGradient>
        <radialGradient id={`h${uid}`} cx="20" cy="8" r="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="white" stopOpacity=".35" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d={HEX_PATH} fill={`url(#g${uid})`} />
      <path d={HEX_PATH} fill={`url(#h${uid})`} />
      <path d={HEX_PATH} fill="none" stroke="white" strokeOpacity=".18" />
      <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={p.r} fill="none" stroke="white" strokeWidth={p.stroke} />
      <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="white" strokeWidth="2.4" strokeLinecap="round" />
      <polyline
        points={MARK.check}
        fill="none"
        stroke="white"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        style={animated ? { strokeDasharray: 1, strokeDashoffset: 1, animation: 'tallerpro-check-draw 1.8s cubic-bezier(0.65,0,0.35,1) 0.15s infinite' } : undefined}
      />
    </svg>
  );
}
