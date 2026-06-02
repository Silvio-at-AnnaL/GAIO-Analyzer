import type { ReactNode } from "react";
import { Info } from "lucide-react";

interface InfoTooltipProps {
  text: string;
  children?: ReactNode;
}

export function InfoTooltip({ text, children }: InfoTooltipProps) {
  return (
    <span className="tooltip-wrapper">
      {children ?? <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />}
      <span className="tooltip-content">{text}</span>
    </span>
  );
}
