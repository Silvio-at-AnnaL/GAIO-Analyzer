interface Dimension {
  label: string;
  value: number;
  color: string;
}

interface Props {
  dimensions: Dimension[];
}

export function RadarDimensions({ dimensions }: Props) {
  const CX = 160, CY = 160;
  const MAX_R = 120;
  const RINGS = 5;
  const N = dimensions.length;

  const pt = (i: number, r: number) => {
    const angle = (i / N) * 2 * Math.PI - Math.PI / 2;
    return {
      x: CX + r * Math.cos(angle),
      y: CY + r * Math.sin(angle),
    };
  };

  const dataPoints = dimensions.map((d, i) => pt(i, (d.value / 100) * MAX_R));
  const polyPoints = dataPoints.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div style={{ background: "#1e2235", borderRadius: 12, padding: 20 }}>
      <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
        <svg width={320} height={320} viewBox="0 0 320 320" style={{ flexShrink: 0 }}>
          {/* Concentric rings */}
          {Array.from({ length: RINGS }, (_, i) => {
            const r = (MAX_R / RINGS) * (i + 1);
            return (
              <circle
                key={i}
                cx={CX}
                cy={CY}
                r={r}
                fill="none"
                stroke="rgba(255,255,255,0.12)"
                strokeWidth={i === RINGS - 1 ? 2 : 1}
              />
            );
          })}

          {/* Axis lines */}
          {dimensions.map((_, i) => {
            const end = pt(i, MAX_R);
            return (
              <line
                key={i}
                x1={CX}
                y1={CY}
                x2={end.x}
                y2={end.y}
                stroke="rgba(255,255,255,0.15)"
                strokeWidth={1}
              />
            );
          })}

          {/* Data polygon */}
          <polygon
            points={polyPoints}
            fill="rgba(212,170,60,0.35)"
            stroke="rgba(212,170,60,0.9)"
            strokeWidth={2}
            strokeLinejoin="round"
          />

          {/* Data point dots */}
          {dataPoints.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={4}
              fill={dimensions[i].color}
              stroke="rgba(255,255,255,0.6)"
              strokeWidth={1.5}
            />
          ))}

          {/* Colored square markers at axis tips */}
          {dimensions.map((d, i) => {
            const end = pt(i, MAX_R + 10);
            return (
              <rect
                key={i}
                x={end.x - 5}
                y={end.y - 5}
                width={10}
                height={10}
                fill={d.color}
                rx={1}
              />
            );
          })}

          {/* Axis labels */}
          {dimensions.map((d, i) => {
            const labelPt = pt(i, MAX_R + 28);
            let anchor: "start" | "middle" | "end" = "middle";
            if (labelPt.x < CX - 5) anchor = "end";
            else if (labelPt.x > CX + 5) anchor = "start";
            return (
              <text
                key={i}
                x={labelPt.x}
                y={labelPt.y + 4}
                textAnchor={anchor}
                fontSize={11}
                fontFamily="DM Sans, sans-serif"
                fontWeight={600}
                fill="rgba(255,255,255,0.85)"
              >
                {d.label}
              </text>
            );
          })}
        </svg>

        {/* Legend */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, justifyContent: "center" }}>
          {dimensions.map((d) => (
            <div key={d.label} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold" style={{ color: d.color }}>
                  {d.label}
                </span>
                <span className="text-sm font-bold" style={{ color: "white" }}>
                  {d.value}
                </span>
              </div>
              <div className="flex gap-0.5">
                {Array.from({ length: 10 }, (_, i) => {
                  const filled = i < Math.round(d.value / 10);
                  return (
                    <div
                      key={i}
                      style={{
                        width: 14,
                        height: 10,
                        borderRadius: 2,
                        background: filled ? d.color : "rgba(255,255,255,0.12)",
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
