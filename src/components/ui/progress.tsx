import { cn } from "@/lib/utils";

export function Progress({ value, max, label, className }: {
  value: number;
  max: number;
  label: string;
  className?: string;
}) {
  const limit = Math.max(1, max);
  const completed = Math.max(0, Math.min(value, limit));
  return <div data-slot="progress" role="progressbar" aria-label={label}
    aria-valuemin={0} aria-valuemax={limit} aria-valuenow={completed}
    className={cn("progress-track", className)}>
    <div className="progress-indicator" style={{ transform: `scaleX(${completed / limit})` }} />
  </div>;
}
