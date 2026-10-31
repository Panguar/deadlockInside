import type { CSSProperties, ReactNode } from "react";

export type GaugeProps = {
  value: number;
  min: number;
  max: number;
  majorEvery: number;
  minorEvery: number;
  format: (value: number) => string;
  label: string;
  reference?: number;
  size?: number;
};

const CX = 100;
const CY = 104;
const RADIUS = 92;
const VIEW_HEIGHT = 112;

// Fraction 0..1 maps to the top semicircle, left (0) to right (1).
function point(fraction: number, radius: number) {
  const theta = Math.PI * (1 - fraction);
  return { x: CX + radius * Math.cos(theta), y: CY - radius * Math.sin(theta) };
}

export function Gauge({
  value,
  min,
  max,
  majorEvery,
  minorEvery,
  format,
  label,
  reference,
  size = 220,
}: GaugeProps) {
  const span = max - min;
  const toFraction = (input: number) => Math.min(1, Math.max(0, (input - min) / span));

  const ticks: ReactNode[] = [];
  const steps = Math.round(span / minorEvery);
  for (let i = 0; i <= steps; i++) {
    const tickValue = min + i * minorEvery;
    const major = Math.abs(tickValue / majorEvery - Math.round(tickValue / majorEvery)) < 1e-9;
    const fraction = toFraction(tickValue);
    const outer = point(fraction, RADIUS);
    const inner = point(fraction, RADIUS - (major ? 9 : 4));
    ticks.push(
      <line
        key={`tick-${i}`}
        className={major ? "gauge-tick gauge-tick-major" : "gauge-tick"}
        x1={outer.x}
        y1={outer.y}
        x2={inner.x}
        y2={inner.y}
      />,
    );
    if (major) {
      const labelPoint = point(fraction, RADIUS - 20);
      ticks.push(
        <text
          key={`label-${i}`}
          className="gauge-tick-label"
          x={labelPoint.x}
          y={labelPoint.y}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {Math.round(tickValue)}
        </text>,
      );
    }
  }

  const needleAngle = -90 + toFraction(value) * 180;
  const needleStyle = { "--angle": `${needleAngle}deg` } as CSSProperties;

  const arcStart = point(0, RADIUS);
  const arcEnd = point(1, RADIUS);

  let referenceLine: ReactNode = null;
  if (reference !== undefined) {
    const from = point(toFraction(reference), RADIUS + 5);
    const to = point(toFraction(reference), RADIUS - 12);
    referenceLine = <line className="gauge-reference" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
  }

  return (
    <svg
      className="gauge-svg"
      viewBox={`0 0 200 ${VIEW_HEIGHT}`}
      width={size}
      height={Math.round((size * VIEW_HEIGHT) / 200)}
      role="img"
      aria-label={`${label}: ${format(value)}`}
      focusable="false"
    >
      <path
        className="gauge-arc"
        d={`M ${arcStart.x} ${arcStart.y} A ${RADIUS} ${RADIUS} 0 0 1 ${arcEnd.x} ${arcEnd.y}`}
      />
      {ticks}
      {referenceLine}
      <line
        className="gauge-needle"
        x1={CX}
        y1={CY}
        x2={CX}
        y2={CY - (RADIUS - 14)}
        style={needleStyle}
      />
      <circle className="gauge-hub" cx={CX} cy={CY} r={6} />
    </svg>
  );
}
