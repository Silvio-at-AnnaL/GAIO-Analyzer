import { useT } from "@/lib/LabelProvider";
import { crawlFailureMessage, readableAnalysisError, robotsHintText, type FailureReport } from "@/lib/crawl-errors";

export function AnalysisErrors({ report, showRobotsHint = false }: { report: FailureReport; showRobotsHint?: boolean }) {
  const t = useT();
  const message = crawlFailureMessage(report, t);
  const hint = showRobotsHint ? robotsHintText(report, t) : null;
  if (!message) return <div className="space-y-1">{Array.isArray(report.errors) && report.errors.map((error, i) =>
    <p key={i} className="text-sm text-muted-foreground">{readableAnalysisError(error, t)}</p>)}</div>;
  return <section className="space-y-3" aria-label={message.title}>
    <h3 className="text-sm font-semibold">{message.title}</h3>
    {message.paragraphs.map((paragraph, i) => <p key={i} className="text-sm text-muted-foreground">{paragraph}</p>)}
    {hint && <section className="space-y-2 border-t border-border pt-3">
      <h4 className="text-sm font-semibold">{hint.title}</h4>
      <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
        {hint.crawlers.map(crawler => <li key={crawler}>{crawler}</li>)}
      </ul>
      {hint.fullyBlocked && <p className="text-sm text-muted-foreground">{hint.fullyBlocked}</p>}
      <p className="text-sm text-muted-foreground">{hint.note}</p>
    </section>}
  </section>;
}
