import { useState } from "react";
import {
  ArrowRight,
  Box,
  Check,
  CircleDashed,
  FileCode2,
  FolderGit2,
  GitBranch,
  Layers3,
  LockKeyhole,
  Minus,
  Network,
  Pin,
  Plus,
  Search,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type { ProjectRecord, Scan, Variable } from "../lib/types";
import { Empty } from "./ui";
export function DriftView({
  scan,
  onSelect,
}: {
  scan: Scan;
  onSelect: (v: Variable) => void;
}) {
  const [only, setOnly] = useState(false),
    [q, setQ] = useState("");
  const vars = scan.variables.filter(
    (v) =>
      (!only || v.drifted) && v.name.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <>
      <div className="info-banner">
        <Network size={18} />
        <div>
          <strong>
            One repository. {scan.environments.length} environments. The full
            picture.
          </strong>
          <p>
            Compare definition presence across files. Values stay masked;
            missing cells may be intentional.
          </p>
        </div>
      </div>
      <div className="table-panel">
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={15} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a variable…"
              aria-label="Search drift variables"
            />
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={only}
              onChange={(e) => setOnly(e.target.checked)}
            />{" "}
            Only show drift
          </label>
        </div>
        <div className="table-scroll">
          <table className="drift-table">
            <thead>
              <tr>
                <th>Variable</th>
                {scan.environments.map((e) => (
                  <th key={e}>
                    <FileCode2 size={13} />
                    {e}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vars.map((v) => (
                <tr key={v.name}>
                  <td>
                    <button className="mono" onClick={() => onSelect(v)}>
                      {v.name}
                    </button>
                    {v.secret && <LockKeyhole size={12} />}
                  </td>
                  {scan.environments.map((e) => {
                    const d = v.definitions.find((d) => d.file === e);
                    return (
                      <td key={e}>
                        <button
                          aria-label={`${v.name} in ${e}: ${d ? "defined" : "missing"}`}
                          title={`${e} · ${d ? (d.hasValue ? "Has a value" : "Empty value") : "Not defined"} · ${d?.tracked ? "Git tracked" : "Git status: " + (scan.gitAvailable ? "not tracked" : "unknown")}`}
                          onClick={() => onSelect(v)}
                          className={`matrix-cell ${d ? (d.hasValue ? "present" : "empty-value") : "absent"}`}
                        >
                          {d ? (
                            d.hasValue ? (
                              <Check size={16} />
                            ) : (
                              <CircleDashed size={16} />
                            )
                          ) : (
                            <Minus size={16} />
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!vars.length && <Empty />}
        <div className="table-footer">
          <span>
            <i className="legend-dot healthy" /> Defined{" "}
            <i className="legend-dot missing" /> Empty{" "}
            <i className="legend-dot dead" /> Missing
          </span>
          <span>Click a cell to inspect its variable</span>
        </div>
      </div>
    </>
  );
}
export function GraphView({
  scan,
  onSelect,
}: {
  scan: Scan;
  onSelect: (v: Variable) => void;
}) {
  const [name, setName] = useState(
      scan.variables.find((v) => v.references.length)?.name || "",
    ),
    [zoom, setZoom] = useState(1);
  const v = scan.variables.find((v) => v.name === name);
  const files = [...new Set(v?.references.map((r) => r.file) || [])].slice(
    0,
    6,
  );
  const services = v?.services || [];
  const edges = files.flatMap((file, i) =>
    [
      ...new Set(
        v?.references.filter((r) => r.file === file).map((r) => r.service) ||
          [],
      ),
    ].map((service) => ({
      file,
      index: i,
      serviceIndex: services.indexOf(service),
    })),
  );
  return (
    <div className="panel graph-panel">
      <div className="table-toolbar">
        <div className="graph-filter">
          <Search size={15} />
          <select
            aria-label="Graph variable"
            value={name}
            onChange={(e) => setName(e.target.value)}
          >
            {scan.variables.map((v) => (
              <option key={v.name}>{v.name}</option>
            ))}
          </select>
        </div>
        <span className="tiny-label">DEPENDENCY EXPLORER</span>
      </div>
      <div className="graph-canvas">
        <div className="graph-heading">
          <span>
            <i className="live-dot" /> Blast radius
          </span>
          <p>
            {files.length} source files · {services.length} services
          </p>
        </div>
        <div className="graph-content" style={{ transform: `scale(${zoom})` }}>
          <div className="graph-column">
            <label>ENVIRONMENT VARIABLE</label>
            {v && (
              <button
                className="graph-node variable-node"
                onClick={() => onSelect(v)}
              >
                <span className="node-icon">
                  <Network size={20} />
                </span>
                <div>
                  <strong>{v.name}</strong>
                  <small>
                    {v.secret ? "Sensitive variable" : "Environment variable"}
                  </small>
                </div>
              </button>
            )}
          </div>
          <div className="graph-connections">
            <svg viewBox="0 0 100 360" preserveAspectRatio="none">
              {files.map((f, i) => (
                <path
                  key={f}
                  d={`M 0 180 C 55 180, 45 ${((i + 0.5) * 360) / files.length}, 100 ${((i + 0.5) * 360) / files.length}`}
                />
              ))}
            </svg>
          </div>
          <div className="graph-column">
            <label>SOURCE FILES</label>
            {files.map((f) => (
              <button
                className="graph-node file-node"
                key={f}
                onClick={() => v && onSelect(v)}
              >
                <FileCode2 size={17} />
                <div>
                  <strong>{f.split("/").slice(-2).join("/")}</strong>
                  <small>
                    {f.split("/").slice(0, -2).join("/") || "repository"}
                  </small>
                </div>
                <span>{v?.references.filter((r) => r.file === f).length}</span>
              </button>
            ))}
          </div>
          <div className="graph-connections">
            <svg viewBox="0 0 100 360" preserveAspectRatio="none">
              {edges.map((e) => (
                <path
                  key={e.file + e.serviceIndex}
                  d={`M 0 ${((e.index + 0.5) * 360) / files.length} C 55 ${((e.index + 0.5) * 360) / files.length}, 45 ${((e.serviceIndex + 0.5) * 360) / Math.max(1, services.length)}, 100 ${((e.serviceIndex + 0.5) * 360) / Math.max(1, services.length)}`}
                />
              ))}
            </svg>
          </div>
          <div className="graph-column">
            <label>SERVICES / PACKAGES</label>
            {services.map((s) => (
              <div className="graph-node service-node" key={s}>
                <Box size={19} />
                <div>
                  <strong>{s}</strong>
                  <small>
                    {v?.references.filter((r) => r.service === s).length}{" "}
                    references
                  </small>
                </div>
              </div>
            ))}
          </div>
        </div>
        {!files.length && (
          <div className="graph-empty">
            <Empty kind="dead" />
          </div>
        )}
        <div className="graph-legend">
          <span>
            <i className="legend-dot healthy" />
            Variable
          </span>
          <span>
            <i className="legend-dot blue" />
            Source file
          </span>
          <span>
            <i className="legend-dot purple" />
            Service
          </span>
        </div>
        <div className="zoom-controls">
          <button
            aria-label="Zoom out"
            onClick={() => setZoom(Math.max(0.6, zoom - 0.1))}
          >
            <Minus size={15} />
          </button>
          <button onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button
            aria-label="Zoom in"
            onClick={() => setZoom(Math.min(1.2, zoom + 0.1))}
          >
            <Plus size={15} />
          </button>
        </div>
      </div>
      <div className="table-footer">
        <span>
          <ShieldCheck size={12} /> Edges reflect detected source references.
          Dynamic usage may be absent.
        </span>
        <span>
          {scan.name} / {scan.branch}
        </span>
      </div>
    </div>
  );
}
export function ProjectsView({
  projects,
  onOpen,
  onImport,
  onPin,
}: {
  projects: ProjectRecord[];
  onOpen: (p: ProjectRecord) => void;
  onImport: () => void;
  onPin: (p: ProjectRecord) => void;
}) {
  return (
    <div className="project-grid">
      {projects.map((p) => (
        <article className="project-card panel" key={p.path}>
          <div className="project-card-top">
            <span className="project-avatar">
              <FolderGit2 size={25} />
            </span>
            <button
              className={`icon-button ${p.pinned ? "accent" : ""}`}
              aria-label={`${p.pinned ? "Unpin" : "Pin"} ${p.name}`}
              onClick={() => onPin(p)}
            >
              <Pin size={15} />
            </button>
          </div>
          <h3>
            {p.name}
            {p.demo && <span className="tiny-label">DEMO</span>}
          </h3>
          <p className="mono muted">{p.path}</p>
          <div className="project-card-stats">
            <span>
              <strong>{p.health}%</strong> Health
            </span>
            <span>
              <strong>{p.issues}</strong> Findings
            </span>
          </div>
          <div className="project-card-footer">
            <small>{new Date(p.scannedAt).toLocaleDateString()}</small>
            <button className="text-button" onClick={() => onOpen(p)}>
              Open repository
              <ArrowRight size={14} />
            </button>
          </div>
        </article>
      ))}
      <button className="add-project" onClick={onImport}>
        <Plus size={25} />
        <strong>Unearth a repository</strong>
        <span>Open a local folder to get started.</span>
      </button>
    </div>
  );
}
export function HistoryView({
  history,
  scan,
}: {
  history: ProjectRecord[];
  scan: Scan;
}) {
  return (
    <>
      <div className="info-banner">
        <GitBranch size={18} />
        <div>
          <strong>Scan history</strong>
          <p>
            Local snapshots of repository health. Secret values are never stored
            in history.
          </p>
        </div>
      </div>
      <div className="panel history-list">
        {history
          .filter((p) => p.path === scan.path)
          .map((p, i) => (
            <div className="history-row" key={p.scannedAt + i}>
              <span className="timeline-icon">
                <Layers3 size={17} />
              </span>
              <div>
                <h3>
                  Repository analyzed{" "}
                  <span className="tiny-label">
                    {i === 0 ? "LATEST" : "SNAPSHOT"}
                  </span>
                </h3>
                <p>
                  {p.name} · {p.issues} findings · {p.health}% health
                </p>
              </div>
              <time>{new Date(p.scannedAt).toLocaleString()}</time>
            </div>
          ))}
      </div>
      <p className="subtle-note">
        <TriangleAlert size={13} /> Variable-level commit history is available
        from the inspector in the desktop application.
      </p>
    </>
  );
}
