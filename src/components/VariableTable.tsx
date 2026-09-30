import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  FileCode2,
  LockKeyhole,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { Variable, View } from "../lib/types";
import { Empty, StatusBadge } from "./ui";
export function VariableTable({
  variables,
  onSelect,
  view = "variables",
  compact = false,
  query = "",
  setQuery,
}: {
  variables: Variable[];
  onSelect: (v: Variable) => void;
  view?: View;
  compact?: boolean;
  query?: string;
  setQuery?: (s: string) => void;
}) {
  const [ownQuery, setOwnQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [service, setService] = useState("all"),
    [file, setFile] = useState("all"),
    [secrets, setSecrets] = useState(false),
    [filters, setFilters] = useState(false),
    [sort, setSort] = useState<"name" | "references" | null>(null),
    [descending, setDescending] = useState(false),
    [page, setPage] = useState(0);
  const q = setQuery ? query : ownQuery;
  const changeQ = (s: string) => {
    (setQuery || setOwnQuery)(s);
    setPage(0);
  };
  const services = [...new Set(variables.flatMap((v) => v.services))].sort();
  const files = [
    ...new Set(variables.flatMap((v) => v.definitions.map((d) => d.file))),
  ].sort();
  const filtered = useMemo(
    () =>
      variables
        .filter(
          (v) =>
            v.name.toLowerCase().includes(q.toLowerCase()) &&
            (status === "all" || v.status === status) &&
            (service === "all" || v.services.includes(service)) &&
            (file === "all" || v.definitions.some((d) => d.file === file)) &&
            (!secrets || v.secret),
        )
        .sort((a, b) =>
          sort
            ? (sort === "name"
                ? a.name.localeCompare(b.name)
                : a.references.length - b.references.length) *
              (descending ? -1 : 1)
            : 0,
        ),
    [variables, q, status, service, file, secrets, sort, descending],
  );
  const limit = compact ? 7 : 12;
  const maxPage = Math.max(0, Math.ceil(filtered.length / limit) - 1);
  const currentPage = Math.min(page, maxPage);
  const rows = filtered.slice(currentPage * limit, currentPage * limit + limit);
  function sorting(key: "name" | "references") {
    if (sort === key) setDescending(!descending);
    else {
      setSort(key);
      setDescending(false);
    }
  }
  return (
    <div className="table-panel">
      <div className="table-toolbar">
        <div className="search-field">
          <Search size={15} />
          <input
            aria-label="Search variables"
            placeholder="Search variables…"
            value={q}
            onChange={(e) => changeQ(e.target.value)}
          />
          <kbd>/</kbd>
        </div>
        <div className="table-controls">
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">All statuses</option>
            {["healthy", "missing", "dead", "exposed", "unknown"].map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by service"
            value={service}
            onChange={(e) => {
              setService(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">All services</option>
            {services.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button
            className={`button small ${filters ? "active" : ""}`}
            onClick={() => setFilters(!filters)}
          >
            <SlidersHorizontal size={13} />
            Filters
            {(file !== "all" || secrets) && <span className="filter-dot" />}
          </button>
        </div>
      </div>
      {filters && (
        <div className="extra-filters">
          <select
            aria-label="Filter by file"
            value={file}
            onChange={(e) => setFile(e.target.value)}
          >
            <option value="all">All environment files</option>
            {files.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          <label>
            <input
              type="checkbox"
              checked={secrets}
              onChange={(e) => setSecrets(e.target.checked)}
            />{" "}
            Secrets only
          </label>
          <button
            className="text-button"
            onClick={() => {
              setFile("all");
              setSecrets(false);
              setStatus("all");
              setService("all");
              changeQ("");
            }}
          >
            <X size={12} />
            Clear filters
          </button>
        </div>
      )}
      <div className="table-scroll">
        <table className="variable-table">
          <thead>
            <tr>
              <th>
                <button onClick={() => sorting("name")}>
                  Variable{" "}
                  {sort === "name" ? (
                    descending ? (
                      <ArrowDown size={11} />
                    ) : (
                      <ArrowUp size={11} />
                    )
                  ) : (
                    <ArrowUpDown size={11} />
                  )}
                </button>
              </th>
              <th>Status</th>
              <th>Environments</th>
              <th>
                <button onClick={() => sorting("references")}>
                  References
                  <ArrowUpDown size={11} />
                </button>
              </th>
              <th>Secret</th>
              {!compact && <th>Last seen</th>}
              <th>Service</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr
                key={v.name}
                onClick={() => onSelect(v)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSelect(v);
                }}
                tabIndex={0}
                aria-label={`Inspect ${v.name}`}
              >
                <td>
                  <span className="variable-name">
                    <span className={`variable-dot ${v.status}`} />
                    {v.name}
                  </span>
                </td>
                <td>
                  <StatusBadge status={v.status} />
                </td>
                <td>
                  <div className="env-tags">
                    {v.definitions.length ? (
                      v.definitions.slice(0, 2).map((d) => (
                        <span key={d.file} title={d.file}>
                          {d.file
                            .split(".env.")[1]
                            ?.replace("development", "dev")
                            .replace("production", "prod") || ".env"}
                        </span>
                      ))
                    ) : (
                      <span className="muted dash">—</span>
                    )}
                    {v.definitions.length > 2 && (
                      <span
                        className="more-env"
                        title={v.definitions
                          .slice(2)
                          .map((d) => d.file)
                          .join(", ")}
                      >
                        +{v.definitions.length - 2}
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  <span
                    className={`reference-count ${v.references.length ? "" : "muted"}`}
                  >
                    <FileCode2 size={13} />
                    {v.references.length}
                  </span>
                </td>
                <td>
                  {v.secret ? (
                    <LockKeyhole size={13} className="secret-icon" />
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                {!compact && <td className="muted">{v.lastSeen}</td>}
                <td>
                  <div className="service-tags">
                    {v.services.slice(0, 2).map((s) => (
                      <span key={s}>{s}</span>
                    ))}
                    {!v.services.length && <span className="muted">—</span>}
                    {v.services.length > 2 && (
                      <span>+{v.services.length - 2}</span>
                    )}
                  </div>
                </td>
                <td>
                  <ChevronRight size={13} className="row-arrow" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <Empty kind={view} />}
      <footer className="table-footer">
        <span>
          Showing {filtered.length ? currentPage * limit + 1 : 0}–
          {Math.min((currentPage + 1) * limit, filtered.length)} of{" "}
          {filtered.length} variables
        </span>
        <div>
          <span>Values masked. Always.</span>
          <LockKeyhole size={11} />
          {!compact && (
            <>
              <button
                className="icon-button"
                aria-label="Previous page"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft size={15} />
              </button>
              <button
                className="icon-button"
                aria-label="Next page"
                disabled={currentPage >= maxPage}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight size={15} />
              </button>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
