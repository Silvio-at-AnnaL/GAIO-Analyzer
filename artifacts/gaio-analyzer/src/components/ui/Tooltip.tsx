import type { ReactNode } from "react";
import { Info } from "lucide-react";

interface TooltipProps {
  text: string;
  children?: ReactNode;
}

export function Tooltip({ text, children }: TooltipProps) {
  return (
    <span className="tooltip-wrapper">
      {children ?? <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />}
      <span className="tooltip-content">{text}</span>
    </span>
  );
}
