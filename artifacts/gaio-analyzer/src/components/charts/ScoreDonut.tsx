import { useT } from "../../lib/LabelProvider";

interface Props { score: number }

export function ScoreDonut({ score }: Props) {
  const t = useT();
  const cx = 130, cy = 130, r = 100;
  const trackLen = Math.PI * r;

  const zoneColor = score >= 71 ? '#16a34a'
    : score >= 41 ? '#eab308' : '#dc2626';

  const needleAngle = Math.PI * (score / 100 - 1);
  const needleLen = 85;
  const nx = cx + needleLen * Math.cos(needleAngle);
  const ny = cy + needleLen * Math.sin(needleAngle);

  const ticks = [0, 25, 50, 75, 100].map(v => {
    const a = Math.PI * (v / 100 - 1);
    const ro = 107, ri = 99;
    return {
      x1: cx + ro * Math.cos(a),
      y1: cy + ro * Math.sin(a),
      x2: cx + ri * Math.cos(a),
      y2: cy + ri * Math.sin(a),
      lx: cx + 118 * Math.cos(a),
      ly: cy + 118 * Math.sin(a),
      label: String(v),
    };
  });

  return (
    <div style={{
      background: '#1e2235',
      borderRadius: 12,
      padding: '24px 24px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%',
      minHeight: 260,
    }}>
      <svg width="260" height="175" viewBox="0 0 260 175">
        {/* Zone background arcs */}
        <path d="M 30 130 A 100 100 0 0 1 230 130"
          fill="none" stroke="#dc2626" strokeWidth="14"
          strokeLinecap="butt"
          strokeDasharray={`${trackLen * 0.4} ${trackLen}`} />
        <path d="M 30 130 A 100 100 0 0 1 230 130"
          fill="none" stroke="#eab308" strokeWidth="14"
          strokeLinecap="butt"
          strokeDasharray={`${trackLen * 0.3} ${trackLen}`}
          strokeDashoffset={-trackLen * 0.4} />
        <path d="M 30 130 A 100 100 0 0 1 230 130"
          fill="none" stroke="#16a34a" strokeWidth="14"
          strokeLinecap="butt"
          strokeDasharray={`${trackLen * 0.3} ${trackLen}`}
          strokeDashoffset={-trackLen * 0.7} />

        {/* Full track border */}
        <path d="M 30 130 A 100 100 0 0 1 230 130"
          fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="15"
          strokeLinecap="round" />

        {/* Tick marks */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
              stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
            <text x={t.lx} y={t.ly + 4}
              textAnchor="middle"
              fontSize={11}
              fontWeight={600}
              fill="rgba(255,255,255,0.85)"
              fontFamily="DM Sans,sans-serif">
              {t.label}
            </text>
          </g>
        ))}

        {/* Needle */}
        <line x1={cx} y1={cy} x2={nx} y2={ny}
          stroke="white" strokeWidth="2.5"
          strokeLinecap="round" />
        <polygon
          points={`${cx - 6},${cy} ${cx + 6},${cy} ${cx},${cy - 12}`}
          fill="white" opacity="0.9" />
        <circle cx={cx} cy={cy} r="7"
          fill="#1e2235" stroke="white" strokeWidth="2" />
        <circle cx={cx} cy={cy} r="3" fill="white" />

        {/* Score display */}
        <text x={cx} y={112} textAnchor="middle"
          fontSize={36} fontWeight="800"
          fill={zoneColor}
          fontFamily="DM Sans,sans-serif">
          {score}
        </text>

        {/* Legend — centered */}
        <g transform="translate(0, 150)">
          <rect x="18" y="0" width="8" height="8" rx="2" fill="#dc2626" />
          <text x="30" y="7.5" fontSize={11} fontWeight={600}
            fill="rgba(255,255,255,0.7)" fontFamily="DM Sans,sans-serif">
            {t("results.score_critical")}
          </text>
          <rect x="93" y="0" width="8" height="8" rx="2" fill="#eab308" />
          <text x="105" y="7.5" fontSize={11} fontWeight={600}
            fill="rgba(255,255,255,0.7)" fontFamily="DM Sans,sans-serif">
            {t("results.score_developing")}
          </text>
          <rect x="195" y="0" width="8" height="8" rx="2" fill="#16a34a" />
          <text x="207" y="7.5" fontSize={11} fontWeight={600}
            fill="rgba(255,255,255,0.7)" fontFamily="DM Sans,sans-serif">
            {t("results.score_strong")}
          </text>
        </g>
      </svg>
    </div>
  );
}
