import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "./cn";

export { cn };

// ── Button ───────────────────────────────────────────────────────────────────
type ButtonVariant = "default" | "outline" | "ghost" | "destructive";
type ButtonSize = "default" | "sm" | "icon";
const btnVariant: Record<ButtonVariant, string> = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  outline: "border border-border bg-card hover:bg-muted",
  ghost: "hover:bg-muted",
  destructive: "bg-destructive text-white hover:bg-destructive/90",
};
const btnSize: Record<ButtonSize, string> = { default: "h-9 px-4", sm: "h-8 px-3 text-sm", icon: "h-9 w-9" };

export function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50",
        btnVariant[variant],
        btnSize[size],
        className,
      )}
      {...props}
    />
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-border bg-card shadow-sm", className)} {...props} />;
}
export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-4", className)} {...props} />;
}
export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("font-semibold leading-none", className)} {...props} />;
}
export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4 pt-0", className)} {...props} />;
}

// ── Badge ────────────────────────────────────────────────────────────────────
type BadgeVariant = "default" | "secondary" | "outline" | "accent" | "success" | "warning" | "destructive";
const badgeVariant: Record<BadgeVariant, string> = {
  default: "border-transparent bg-primary/10 text-primary",
  secondary: "border-transparent bg-muted text-muted-foreground",
  outline: "border-border text-foreground",
  accent: "border-transparent bg-accent/10 text-accent",
  success: "border-transparent bg-success/10 text-success",
  warning: "border-transparent bg-warning/15 text-warning",
  destructive: "border-transparent bg-destructive/10 text-destructive",
};
export function Badge({
  className,
  variant = "default",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium leading-none",
        badgeVariant[variant],
        className,
      )}
      {...props}
    />
  );
}

// ── Inputs ───────────────────────────────────────────────────────────────────
const fieldBase =
  "w-full rounded-md border border-border bg-card px-3 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, "h-9", className)} {...props} />;
}
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, "min-h-24 py-2 leading-relaxed", className)} {...props} />;
}
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(fieldBase, "h-9 cursor-pointer pr-8", className)} {...props} />;
}

// ── PageHeader ───────────────────────────────────────────────────────────────
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ── StatusBadge (the artifact lifecycle, rendered consistently) ───────────────
const LIFECYCLE: Record<string, { label: string; variant: BadgeVariant; dot: string }> = {
  ai_generated: { label: "AI Generated", variant: "default", dot: "✦" },
  draft: { label: "Draft", variant: "secondary", dot: "○" },
  under_review: { label: "Under Review", variant: "warning", dot: "●" },
  approved: { label: "Approved", variant: "accent", dot: "✓" },
  published: { label: "Published", variant: "success", dot: "●" },
  archived: { label: "Archived", variant: "outline", dot: "▣" },
};
export function StatusBadge({ status }: { status: string }) {
  const s = LIFECYCLE[status] ?? { label: status, variant: "secondary" as const, dot: "•" };
  return (
    <Badge variant={s.variant}>
      <span aria-hidden>{s.dot}</span>
      {s.label}
    </Badge>
  );
}

// ── EmptyState ───────────────────────────────────────────────────────────────
export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 p-10 text-center">
      <p className="font-medium">{title}</p>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      {action}
    </div>
  );
}
