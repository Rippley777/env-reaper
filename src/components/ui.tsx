import {
  Check,
  AlertTriangle,
  Skull,
  Flame,
  HelpCircle,
  X,
  ArrowUpRight,
  Shield,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Status } from "../lib/types";
import { statusLabels } from "../lib/types";
export const statusIcons = {
  healthy: Check,
  missing: AlertTriangle,
  dead: Skull,
  exposed: Flame,
  unknown: HelpCircle,
};
export function StatusBadge({ status }: { status: Status }) {
  const Icon = statusIcons[status];
  return (
    <span className={`badge ${status}`}>
      <Icon size={11} />
      {statusLabels[status]}
    </span>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? "wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            autoFocus
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function Empty({ kind = "results" }: { kind?: string }) {
  return (
    <div className="empty">
      <Shield size={30} />
      <h3>
        {kind === "dead"
          ? "The graveyard is empty."
          : kind === "missing"
            ? "No missing souls."
            : kind === "secrets"
              ? "Nothing buried here."
              : "Nothing lurking here."}
      </h3>
      <p>
        {kind === "dead"
          ? "No unused definitions detected in this view."
          : kind === "missing"
            ? "Everything referenced appears to have a home."
            : "Try changing your filters or scanning another repository."}
      </p>
    </div>
  );
}
export function SectionTitle({
  title,
  tag,
  action,
  onAction,
}: {
  title: string;
  tag?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="section-title">
      <h3>
        {title}
        {tag && <span className="tiny-label">{tag}</span>}
      </h3>
      {action && (
        <button className="text-button" onClick={onAction}>
          {action}
          <ArrowUpRight size={13} />
        </button>
      )}
    </div>
  );
}
