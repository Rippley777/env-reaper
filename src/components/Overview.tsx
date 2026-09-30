import {
  Activity,
  ArrowRight,
  Check,
  ChevronRight,
  FileCode2,
  Flame,
  GitBranch,
  Layers3,
  LockKeyhole,
  ScanLine,
  ShieldCheck,
  Skull,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import type { Scan, Variable, View } from "../lib/types";
import { getHealth } from "../lib/types";
import { SectionTitle } from "./ui";
import { VariableTable } from "./VariableTable";
export function Overview({
  scan,
  onNavigate,
  onSelect,
}: {
  scan: Scan;
  onNavigate: (v: View) => void;
  onSelect: (v: Variable) => void;
}) {
  const vars = scan.variables;
  const healthy = vars.filter((v) => v.status === "healthy").length;
  const missing = vars.filter((v) => v.status === "missing").length;
  const dead = vars.filter((v) => v.status === "dead").length;
  const secrets = vars.filter((v) => v.secret).length;
  const exposed = vars.filter((v) => v.status === "exposed").length;
  const drift = vars.filter((v) => v.drifted).length;
  const health = getHealth(vars);
  const metrics = [
    {
      title: "Total variables",
      value: vars.length,
      icon: Layers3,
      color: "neutral",
      sub: `Across ${scan.environments.length} environments`,
      view: "variables",
    },
    {
      title: "Healthy",
      value: healthy,
      icon: ShieldCheck,
      color: "green",
      sub: "Defined & referenced",
      view: "variables",
    },
    {
      title: "Missing souls",
      value: missing,
      icon: TriangleAlert,
      color: "amber",
      sub: "Referenced, never defined",
      view: "missing",
    },
    {
      title: "Dead variables",
      value: dead,
      icon: Skull,
      color: "gray",
      sub: "Defined, never referenced",
      view: "dead",
    },
    {
      title: "Secrets",
      value: secrets,
      icon: LockKeyhole,
      color: "purple",
      sub: `${exposed} potentially exposed`,
      view: "secrets",
    },
    {
      title: "Config drift",
      value: drift,
      icon: Workflow,
      color: "blue",
      sub: "Inconsistent environments",
      view: "drift",
    },
  ];
  return (
    <>
      <div className="metrics">
        {metrics.map((m) => (
          <button
            className={`metric ${m.color}`}
            key={m.title}
            onClick={() => onNavigate(m.view as View)}
          >
            <div className="metric-label">
              <span>{m.title}</span>
              <m.icon size={15} />
            </div>
            <strong>{m.value.toString().padStart(2, "0")}</strong>
            <span className="metric-sub">{m.sub}</span>
          </button>
        ))}
      </div>
      <div className="overview-grid">
        <section className="panel health-panel">
          <SectionTitle title="Environment health" tag="LIVE SNAPSHOT" />
          <div className="health-body">
            <div className="health-score">
              <strong>
                {health}
                <span>%</span>
              </strong>
              <div>
                <span
                  className={`badge ${health >= 90 ? "healthy" : "missing"}`}
                >
                  {health >= 90 ? <Check size={11} /> : <Activity size={11} />}{" "}
                  {health >= 90 ? "Looking healthy" : "Needs attention"}
                </span>
                <p>
                  {missing + exposed + dead
                    ? `${missing + exposed + dead} findings worth a closer look.`
                    : "Your configuration is looking clean."}
                </p>
              </div>
            </div>
            <div
              className="health-bar"
              aria-label={`${healthy} healthy, ${missing} missing, ${dead} dead, ${exposed} exposed`}
            >
              <span className="healthy" style={{ flex: healthy || 0.01 }} />
              <span className="missing" style={{ flex: missing || 0.01 }} />
              <span className="dead" style={{ flex: dead || 0.01 }} />
              <span className="exposed" style={{ flex: exposed || 0.01 }} />
            </div>
            <div className="health-legend">
              {[
                ["Healthy", healthy, "healthy"],
                ["Missing", missing, "missing"],
                ["Dead", dead, "dead"],
                ["Exposed", exposed, "exposed"],
              ].map(([label, n, status]) => (
                <span key={label}>
                  <i className={`legend-dot ${status}`} />
                  {label}
                  <b>{n}</b>
                </span>
              ))}
            </div>
          </div>
          <div className="health-foot">
            <ShieldCheck size={13} />
            <span>A pulse check, not a security guarantee.</span>
            <span className="mono">LOCAL ANALYSIS</span>
          </div>
        </section>
        <section className="panel attention-panel">
          <SectionTitle
            title="On the reaper’s radar"
            tag={`${exposed + missing + dead} FINDINGS`}
          />
          <div className="findings">
            <button onClick={() => onNavigate("secrets")}>
              <span className="finding-icon red">
                <Flame size={17} />
              </span>
              <span>
                <strong>
                  {exposed
                    ? `${exposed} secrets in tracked files`
                    : "No exposed secrets detected"}
                </strong>
                <small>
                  {scan.gitAvailable
                    ? "Credentials may be in your Git history."
                    : "Git status unavailable for browser imports."}
                </small>
              </span>
              <span className="severity red">{exposed ? "HIGH" : "CLEAR"}</span>
              <ChevronRight size={14} />
            </button>
            <button onClick={() => onNavigate("missing")}>
              <span className="finding-icon amber">
                <TriangleAlert size={17} />
              </span>
              <span>
                <strong>{missing} missing environment variables</strong>
                <small>Your code is expecting a few more souls.</small>
              </span>
              <ChevronRight size={14} />
            </button>
            <button onClick={() => onNavigate("dead")}>
              <span className="finding-icon gray">
                <Skull size={17} />
              </span>
              <span>
                <strong>{dead} variables with no signs of life</strong>
                <small>A little configuration cleanup is in order.</small>
              </span>
              <ChevronRight size={14} />
            </button>
          </div>
        </section>
      </div>
      <section className="inventory-section">
        <SectionTitle
          title="Variable inventory"
          tag={String(vars.length)}
          action="Explore all variables"
          onAction={() => onNavigate("variables")}
        />
        <VariableTable variables={vars} compact onSelect={onSelect} />
      </section>
      <div className="bottom-grid">
        <button className="graph-teaser" onClick={() => onNavigate("graph")}>
          <div className="mini-graph">
            <span>
              <GitBranch size={17} />
            </span>
            <i />
            <span>
              <FileCode2 size={17} />
            </span>
            <i />
            <span>
              <Layers3 size={17} />
            </span>
          </div>
          <div>
            <h3>Follow the dependencies.</h3>
            <p>See the blast radius before you change a variable.</p>
          </div>
          <span className="text-button">
            Explore env graph <ArrowRight size={14} />
          </span>
        </button>
        <div className="local-note">
          <span className="local-note-icon">
            <ScanLine size={23} />
          </span>
          <div>
            <strong>Your secrets stay yours.</strong>
            <p>Scanned locally. Never sent to a server.</p>
          </div>
          <LockKeyhole size={13} />
        </div>
      </div>
    </>
  );
}
