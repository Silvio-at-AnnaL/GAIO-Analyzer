export function RadarDimensions({ dimensions }: {
  dimensions: Array<{ label: string; value: number; color: string }>;
}) {
  const CX = 160, CY = 160, MAX_R = 120, RINGS = 5;
  const N = dimensions.length;

  const pt = (i: number, r: number) => {
    const angle = (i / N) * 2 * Math.PI - Math.PI / 2;
    return { x: CX + r * Math.cos(angle), y: CY + r * Math.sin(angle) };
  };

  const dataPoints = dimensions.map((d, i) => pt(i, (d.value / 100) * MAX_R));
  const polyPoints = dataPoints.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div style={{ background: "#1e2235", borderRadius: 12, padding: 20, height: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center", height: "100%" }}>

        {/* Chart SVG */}
        <svg width={280} height={280} viewBox="0 0 320 320" style={{ flexShrink: 0 }}>

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
                stroke={i === RINGS - 1 ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.1)"}
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

          {/* Filled polygon */}
          <polygon
            points={polyPoints}
            fill="rgba(212,170,60,0.3)"
            stroke="rgba(212,170,60,0.85)"
            strokeWidth={2}
            strokeLinejoin="round"
          />

          {/* Dots on data points */}
          {dataPoints.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={5}
              fill={dimensions[i].color}
              stroke="rgba(255,255,255,0.7)"
              strokeWidth={1.5}
            />
          ))}

          {/* Square markers at axis tips */}
          {dimensions.map((d, i) => {
            const end = pt(i, MAX_R + 12);
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

          {/* Labels */}
          {dimensions.map((d, i) => {
            const lp = pt(i, MAX_R + 30);
            const anchor = lp.x < CX - 5 ? "end" : lp.x > CX + 5 ? "start" : "middle";
            return (
              <text
                key={i}
                x={lp.x}
                y={lp.y + 4}
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
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, justifyContent: "center" }}>
          {dimensions.map((d) => (
            <div key={d.label}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: d.color }}>
                  {d.label}
                </span>
                <span style={{ fontSize: 13, fontWeight: 800, color: "white" }}>
                  {d.value}
                </span>
              </div>
              <div style={{ display: "flex", gap: 2 }}>
                {Array.from({ length: 10 }, (_, i) => {
                  const fullSegments = Math.floor(d.value / 10);
                  const fraction = (d.value % 10) / 10;
                  let segmentBg: string;
                  if (i < fullSegments) {
                    segmentBg = d.color;
                  } else if (i === fullSegments && fraction > 0) {
                    segmentBg = `linear-gradient(to right, ${d.color} ${fraction * 100}%, rgba(255,255,255,0.1) ${fraction * 100}%)`;
                  } else {
                    segmentBg = "rgba(255,255,255,0.1)";
                  }
                  return (
                    <div
                      key={i}
                      style={{
                        flex: 1,
                        height: 9,
                        borderRadius: 2,
                        background: segmentBg,
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
