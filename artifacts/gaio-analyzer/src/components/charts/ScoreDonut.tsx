import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

interface Props {
  score: number;
}

export function ScoreDonut({ score }: Props) {
  const data = [
    { name: "Score", value: score },
    { name: "Remaining", value: 100 - score },
  ];

  const getColor = (s: number) => {
    if (s >= 71) return "hsl(142 71% 45%)";
    if (s >= 41) return "hsl(35 92% 65%)";
    return "hsl(0 84% 60%)";
  };

  const color = getColor(score);

  return (
    <div className="relative w-40 h-40">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={65}
            startAngle={90}
            endAngle={-270}
            dataKey="value"
            strokeWidth={0}
          >
            <Cell fill={color} />
            <Cell fill="hsl(217 25% 15%)" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold font-mono" style={{ color }}>
          {score}
        </span>
        <span className="text-xs text-muted-foreground font-mono">/100</span>
      </div>
    </div>
  );
}
