import React from "react";
import { crawlReliabilityNotices } from "@/lib/crawl-reliability";

export function CrawlReliabilityNotices({
  reliability, evaluated, t,
}: {
  reliability: Record<string, unknown>;
  evaluated: number;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  return <>{crawlReliabilityNotices(reliability, evaluated, t).map(text =>
    <p key={text} className="text-sm text-amber-700 dark:text-amber-400">{text}</p>,
  )}</>;
}
