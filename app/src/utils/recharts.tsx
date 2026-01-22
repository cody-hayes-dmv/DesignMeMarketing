import React from "react";

const RADIAN = Math.PI / 180;

type PieLabelProps = {
  cx?: number | string;
  cy?: number | string;
  midAngle?: number;
  outerRadius?: number | string;
  fill?: string;
  value?: number;
  percent?: number;
};

export function createNonOverlappingPieValueLabel(options?: {
  minGapPx?: number;
  extendPx?: number;
  smallSliceExtendPx?: number;
  fontSizePx?: number;
  fontWeight?: number;
  formatValue?: (value: number) => string;
}): any {
  const used = { left: [] as number[], right: [] as number[] };
  const minGapPx = options?.minGapPx ?? 14;
  const extendPx = options?.extendPx ?? 18;
  const smallSliceExtendPx = options?.smallSliceExtendPx ?? 14;
  const fontSizePx = options?.fontSizePx ?? 14;
  const fontWeight = options?.fontWeight ?? 600;
  const formatValue =
    options?.formatValue ?? ((v: number) => (Number.isFinite(v) ? v.toLocaleString() : "0"));

  const toNum = (v: number | string | undefined) => {
    if (typeof v === "number") return v;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  // Recharts passes a broader props object; keep this callback wide for assignability.
  return function renderPieValueLabel(props: any) {
    const p = props as PieLabelProps;
    const cx = toNum(p.cx);
    const cy = toNum(p.cy);
    const midAngle = p.midAngle ?? 0;
    const outerRadius = toNum(p.outerRadius);
    const value = Number(p.value ?? 0);
    const percent = p.percent ?? 0;
    const fill = p.fill ?? "#6B7280";

    if (!Number.isFinite(value) || value <= 0) return null;

    const sin = Math.sin(-RADIAN * midAngle);
    const cos = Math.cos(-RADIAN * midAngle);
    const isRight = cos >= 0;
    const side = isRight ? used.right : used.left;

    // Start -> elbow -> end. Extend more for tiny slices to keep text readable.
    const extra = percent < 0.06 ? smallSliceExtendPx : 0;
    const sx = cx + (outerRadius + 2) * cos;
    const sy = cy + (outerRadius + 2) * sin;
    const mx = cx + (outerRadius + 12) * cos;
    const my = cy + (outerRadius + 12) * sin;
    const ex = cx + (outerRadius + 12 + extendPx + extra) * cos;

    // Nudge end-Y if it would collide with an existing label on the same side.
    let ey = my;
    const minY = cy - outerRadius - 20;
    const maxY = cy + outerRadius + 20;
    for (let i = 0; i < 12; i++) {
      const conflict = side.find((y) => Math.abs(y - ey) < minGapPx);
      if (conflict === undefined) break;
      ey = ey + (ey >= conflict ? minGapPx : -minGapPx);
      ey = Math.max(minY, Math.min(maxY, ey));
    }
    side.push(ey);

    const textAnchor = isRight ? "start" : "end";
    const tx = ex + (isRight ? 6 : -6);
    const ty = ey;

    return (
      <g>
        <polyline
          points={`${sx},${sy} ${mx},${my} ${ex},${ey}`}
          stroke={fill}
          fill="none"
          strokeWidth={1}
        />
        <text
          x={tx}
          y={ty}
          textAnchor={textAnchor}
          dominantBaseline="central"
          fill={fill}
          style={{ fontSize: fontSizePx, fontWeight }}
        >
          {formatValue(value)}
        </text>
      </g>
    );
  };
}

