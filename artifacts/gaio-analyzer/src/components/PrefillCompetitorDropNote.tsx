import type { PrefillResponse } from "@workspace/api-client-react";
import { useT } from "@/lib/LabelProvider";

type DropCounts = Pick<PrefillResponse, "droppedUnfit" | "droppedUnreachable" | "droppedDuplicateCompany">;

export function PrefillCompetitorDropNote({ data }: { data: DropCounts }) {
  const t = useT();
  const counts = [
    ["unfit", data.droppedUnfit ?? 0],
    ["unreachable", data.droppedUnreachable ?? 0],
    ["duplicate", data.droppedDuplicateCompany ?? 0],
  ] as const;
  const total = counts.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) return null;
  return <div className="text-xs text-muted-foreground">
    <p>{t(`domain.competitor_dropped_intro_${total === 1 ? "one" : "other"}`, { n: total })}</p>
    <ul className="list-disc pl-5">
      {counts.filter(([, count]) => count > 0).map(([reason, count]) =>
        <li key={reason}>{t(`domain.competitor_dropped_${reason}_${count === 1 ? "one" : "other"}`, { n: count })}</li>
      )}
    </ul>
  </div>;
}
