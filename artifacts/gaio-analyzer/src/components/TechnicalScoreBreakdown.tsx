import type { TechnicalScoreBreakdown as Breakdown } from "@workspace/api-client-react";
import { technicalDetail, technicalPoints, type TechnicalT } from "../lib/technical-breakdown";

export function TechnicalScoreBreakdown({ breakdown, t }: { breakdown?: Breakdown; t: TechnicalT }) {
  if (!breakdown) return null;
  return <section className="mt-6" aria-label={t("technical.breakdown_title")}>
    <h4 className="text-sm font-semibold mb-3">{t("technical.breakdown_title")}</h4>
    <div className="overflow-x-auto">
      <table className="w-full text-xs text-left">
        <thead><tr className="border-b border-border">
          {["component", "weight", "points", "detail"].map(key =>
            <th key={key} scope="col" className="p-2 font-semibold">{t(`technical.${key}`)}</th>)}
        </tr></thead>
        <tbody>{breakdown.components.map(c => <tr key={c.key} className="border-b border-border/50">
          <th scope="row" className="p-2 font-medium">{t(`technical.${c.key}`)}</th>
          <td className="p-2 font-mono">{technicalPoints(c.weight)}</td>
          <td className="p-2 font-mono">{c.points === null ? t("technical.not_evaluable") : technicalPoints(c.points)}</td>
          <td className="p-2 text-muted-foreground">{technicalDetail(c, t)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">{t("technical.evaluated_weight", { weight: breakdown.evaluatedWeight })}</p>
  </section>;
}
