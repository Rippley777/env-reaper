import { trackView } from "./lib/analytics";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  ExternalLink,
  FileCode2,
  FilePlus2,
  Flame,
  FolderGit2,
  FolderOpen,
  GitBranch,
  History,
  LayoutDashboard,
  ListFilter,
  LockKeyhole,
  Network,
  PanelLeftClose,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
  Settings2,
  ShieldCheck,
  Skull,
  Sparkles,
  SquareTerminal,
  TriangleAlert,
  Workflow,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  ProjectRecord,
  Scan,
  SourceFile,
  Variable,
  View,
} from "./lib/types";
import { getHealth } from "./lib/types";
import { demoScan } from "./lib/demo";
import {
  download,
  exampleText,
  invoke,
  native,
  pickNative,
  readFiles,
  scanInWorker,
} from "./lib/platform";
import { Modal, StatusBadge } from "./components/ui";
import { Overview } from "./components/Overview";
import { VariableTable } from "./components/VariableTable";
import {
  DriftView,
  GraphView,
  HistoryView,
  ProjectsView,
} from "./components/Views";
const navItems: {
  id: View;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
}[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, shortcut: "1" },
  { id: "variables", label: "Variables", icon: ListFilter, shortcut: "2" },
  { id: "dead", label: "Dead variables", icon: Skull },
  { id: "missing", label: "Missing souls", icon: TriangleAlert },
  { id: "secrets", label: "Secret graveyard", icon: LockKeyhole },
  { id: "drift", label: "Configuration drift", icon: Workflow },
  { id: "graph", label: "Env graph", icon: Network },
  { id: "history", label: "Scan history", icon: History },
];
const headings: Record<View, { title: string; description: string }> = {
  overview: {
    title: "Repository overview",
    description: "Every variable has a story. Find out which ones have ended.",
  },
  variables: {
    title: "Variable explorer",
    description:
      "Every dependency, definition, and loose end. All in one place.",
  },
  dead: {
    title: "Dead variables",
    description: "Defined in your config. Nowhere to be found in your code.",
  },
  missing: {
    title: "Missing souls",
    description: "Your code is calling. These variables aren’t answering.",
  },
  secrets: {
    title: "Secret graveyard",
    description: "Find what’s sensitive. See what might have escaped.",
  },
  drift: {
    title: "Configuration drift",
    description: "Spot the gaps between local, staging, and production.",
  },
  graph: {
    title: "Environment graph",
    description:
      "Follow a variable through your codebase. Understand its blast radius.",
  },
  history: {
    title: "Scan history",
    description: "A local record of your repository’s configuration health.",
  },
  projects: {
    title: "Your repositories",
    description: "A little less configuration chaos. One repository at a time.",
  },
  settings: {
    title: "Settings",
    description: "Make the reaper feel at home in your workflow.",
  },
};
function stored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function record(scan: Scan): ProjectRecord {
  return {
    name: scan.name,
    path: scan.path,
    health: getHealth(scan.variables),
    issues: scan.variables.filter((v) => v.status !== "healthy" || v.drifted)
      .length,
    scannedAt: scan.scannedAt,
    demo: scan.demo,
  };
}
export default function App() {
  const [scan, setScan] = useState<Scan>(demoScan),
    [view, setView] = useState<View>("overview"),
    [selected, setSelected] = useState<Variable | null>(null),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [toast, setToast] = useState(""),
    [query, setQuery] = useState(""),
    [palette, setPalette] = useState(false),
    [commandQuery, setCommandQuery] = useState(""),
    [modal, setModal] = useState<
      "example" | "help" | "reap" | "open-file" | null
    >(null),
    [review, setReview] = useState<{
      file: string;
      before: string;
      after: string;
      token?: string;
    } | null>(null),
    [watch, setWatch] = useState(false),
    [service, setService] = useState("all"),
    [editor, setEditor] = useState(() => stored("envreaper.editor", "vscode")),
    [compact, setCompact] = useState(() => stored("envreaper.compact", false)),
    [collapsed, setCollapsed] = useState(false),
    [notice, setNotice] = useState(false),
    [gitHistory, setGitHistory] = useState<
      { hash: string; date: string; subject: string }[] | null
    >(null),
    [historyLoading, setHistoryLoading] = useState(false),
    [fileToOpen, setFileToOpen] = useState<{
      file: string;
      line: number;
    } | null>(null),
    [undoToken, setUndoToken] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>(() =>
    stored("envreaper.projects", [record(demoScan())]),
  );
  const [history, setHistory] = useState<ProjectRecord[]>(() =>
    stored("envreaper.history", [record(demoScan())]),
  );
  const sourceFiles = useRef<SourceFile[]>([]),
    fileInput = useRef<HTMLInputElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const running = useRef(false);
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 5000);
  }, []);
  const navigate = useCallback((next: View) => {
    setView(next);
    setSelected(null);
    setQuery("");
    setPalette(false);
  }, []);
  const acceptScan = useCallback((result: Scan) => {
    setScan(result);
    setSelected((current) =>
      current
        ? result.variables.find((v) => v.name === current.name) || null
        : null,
    );
    const r = record(result);
    setProjects((prev) => [
      { ...r, pinned: prev.find((p) => p.path === r.path)?.pinned },
      ...prev.filter((p) => p.path !== r.path),
    ]);
    setHistory((prev) => [r, ...prev].slice(0, 100));
  }, []);
  useEffect(() => {
    trackView(view);
  }, [view]);
  useEffect(() => {
    localStorage.setItem("envreaper.projects", JSON.stringify(projects));
  }, [projects]);
  useEffect(() => {
    localStorage.setItem("envreaper.history", JSON.stringify(history));
  }, [history]);
  useEffect(() => {
    localStorage.setItem("envreaper.editor", JSON.stringify(editor));
    localStorage.setItem("envreaper.compact", JSON.stringify(compact));
  }, [editor, compact]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(
        (e.target as HTMLElement).tagName,
      );
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
      if (e.key === "Escape") {
        setPalette(false);
        setSelected(null);
        setModal(null);
        setReview(null);
        setNotice(false);
      }
      if (!typing && e.key === "/") {
        e.preventDefault();
        if (view !== "overview" && view !== "variables") navigate("variables");
        setTimeout(
          () =>
            document
              .querySelector<HTMLInputElement>(
                '[aria-label="Search variables"]',
              )
              ?.focus(),
          50,
        );
      }
      if (!typing && (e.metaKey || e.ctrlKey) && e.key === "o") {
        e.preventDefault();
        navigate("projects");
      }
      if (!typing && (e.metaKey || e.ctrlKey) && ["1", "2"].includes(e.key)) {
        e.preventDefault();
        navigate(e.key === "1" ? "overview" : "variables");
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [navigate, view]);
  // Trap keyboard focus in whichever dialog or inspector is active.
  useEffect(() => {
    if (!palette && !modal && !review && !selected) return;
    const previous = document.activeElement as HTMLElement;
    const dialog = Array.from(
      document.querySelectorAll<HTMLElement>('[role="dialog"]'),
    ).at(-1);
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input,select,[tabindex="0"]',
        ) || [],
      );
    (palette
      ? dialog?.querySelector<HTMLInputElement>("input")
      : focusable()[0]
    )?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [palette, modal, review, selected?.name]);
  const runScan = useCallback(
    async (path?: string, quiet = false) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      setProgress(0);
      try {
        let result: Scan;
        if (native && (!scan.demo || path)) {
          result = await invoke<Scan>("scan_project", {
            path: path || scan.path,
          });
        } else if (sourceFiles.current.length) {
          result = await scanInWorker(
            sourceFiles.current,
            scan.name,
            scan.path,
          );
        } else {
          await new Promise((r) => setTimeout(r, 900));
          result = demoScan();
        }
        acceptScan(result);
        if (!quiet)
          notify(
            `${result.variables.length} variables analyzed. ${result.demo ? "Demo scan" : "Local scan"} complete.`,
          );
      } catch (e) {
        notify(`Scan failed: ${String(e)}`);
      } finally {
        setBusy(false);
        running.current = false;
      }
    },
    [scan, acceptScan, notify],
  );
  useEffect(() => {
    if (!watch || !native || scan.demo) return;
    const timer = setInterval(() => void runScan(undefined, true), 15000);
    return () => clearInterval(timer);
  }, [watch, runScan, scan.demo]);
  const openProject = async () => {
    setPalette(false);
    if (native) {
      try {
        const path = await pickNative();
        if (path) {
          sourceFiles.current = [];
          setService("all");
          await runScan(path);
          navigate("overview");
        }
      } catch (e) {
        notify(String(e));
      }
    } else fileInput.current?.click();
  };
  const importFolder = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setProgress(0);
    try {
      const name =
        files[0].webkitRelativePath.split("/")[0] || "Local repository";
      sourceFiles.current = await readFiles(files, setProgress);
      const result = await scanInWorker(sourceFiles.current, name, name);
      acceptScan(result);
      setService("all");
      navigate("overview");
      notify(
        `Scanned ${result.files} files locally. Git inspection requires the desktop app.`,
      );
    } catch (e) {
      notify(String(e));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const selectVariable = (v: Variable) => {
    setSelected(v);
    setGitHistory(null);
  };
  const scopedVars = scan.variables.filter(
    (v) => service === "all" || v.services.includes(service),
  );
  const scopedScan = { ...scan, variables: scopedVars };
  const visibleVars = scopedVars.filter((v) =>
    view === "dead"
      ? v.status === "dead"
      : view === "missing"
        ? v.status === "missing"
        : view === "secrets"
          ? v.secret
          : true,
  );
  const dead = scan.variables.filter((v) => v.status === "dead").length,
    missing = scan.variables.filter((v) => v.status === "missing").length,
    exposed = scan.variables.filter((v) => v.status === "exposed").length;
  const exportReport = () => {
    download(
      JSON.stringify(
        {
          ...scan,
          variables: scan.variables.map((v) => ({
            ...v,
            definitions: v.definitions.map(({ fingerprint: _, ...d }) => d),
          })),
        },
        null,
        2,
      ),
      `${scan.name}-env-report.json`,
      "application/json",
    );
    notify("Masked scan report exported.");
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify("Copied to clipboard.");
    } catch {
      notify(
        "Clipboard access unavailable. Select and copy the text manually.",
      );
    }
  };
  const prepareChange = async (
    file: string,
    operation: "remove" | "placeholder" | "example",
    name?: string,
  ) => {
    if (native && !scan.demo) {
      try {
        setReview(
          await invoke("preview_change", {
            path: scan.path,
            file,
            operation,
            name: name || null,
          }),
        );
        setModal(null);
        setSelected(null);
      } catch (e) {
        notify(String(e));
      }
    } else {
      const content =
        operation === "example"
          ? exampleText(scan)
          : operation === "remove"
            ? `- ${name}=<masked>`
            : `+ ${name}=`;
      setReview({
        file,
        before: operation === "remove" ? content : "",
        after: operation === "remove" ? "" : content,
      });
      setModal(null);
      setSelected(null);
    }
  };
  const applyChange = async () => {
    if (!review) return;
    if (review.token) {
      try {
        const undo = await invoke<string>("apply_change", {
          token: review.token,
        });
        setUndoToken(undo);
        setReview(null);
        await runScan();
        notify("Change applied. Undo is available in this session.");
      } catch (e) {
        notify(String(e));
      }
    } else {
      download(
        review.after ||
          `# Review removal of this key in ${review.file}\n${review.before}\n`,
        review.after.startsWith("# Generated")
          ? ".env.example"
          : `${review.file.split("/").pop()}.patch`,
      );
      setReview(null);
      notify(
        review.file === ".env.example"
          ? "Example downloaded. If your browser removed the leading dot, rename it to .env.example."
          : "Review file downloaded. No repository files were changed.",
      );
    }
  };
  const showHistory = async () => {
    if (!selected) return;
    if (!native || scan.demo) {
      notify(
        scan.demo
          ? "Demo repository: commit history is not real. Open a local repository in the desktop app."
          : "Git history requires the desktop application.",
      );
      return;
    }
    setHistoryLoading(true);
    try {
      setGitHistory(
        await invoke("variable_history", {
          path: scan.path,
          name: selected.name,
        }),
      );
    } catch (e) {
      notify(String(e));
    } finally {
      setHistoryLoading(false);
    }
  };
  const commands = [
    {
      label: "Scan repository",
      icon: ScanLine,
      action: () => {
        setPalette(false);
        void runScan();
      },
    },
    {
      label: "Find variable",
      icon: Search,
      action: () => navigate("variables"),
    },
    {
      label: "Show missing variables",
      icon: TriangleAlert,
      action: () => navigate("missing"),
    },
    {
      label: "Show dead variables",
      icon: Skull,
      action: () => navigate("dead"),
    },
    {
      label: "Show secrets",
      icon: LockKeyhole,
      action: () => navigate("secrets"),
    },
    {
      label: "Generate .env.example",
      icon: FilePlus2,
      action: () => {
        setPalette(false);
        setModal("example");
      },
    },
    {
      label: "Compare environments",
      icon: Workflow,
      action: () => navigate("drift"),
    },
    {
      label: "Open project folder",
      icon: FolderOpen,
      action: () => void openProject(),
    },
    {
      label: "Explore dependency graph",
      icon: Network,
      action: () => navigate("graph"),
    },
    {
      label: "Export scan report",
      icon: ArrowDownToLine,
      action: () => {
        setPalette(false);
        exportReport();
      },
    },
    ...(native
      ? [
          {
            label: "Open terminal",
            icon: SquareTerminal,
            action: () => {
              setPalette(false);
              void invoke("open_location", {
                path: scan.path,
                file: ".",
                line: 1,
                editor: "terminal",
              }).catch((e) => notify(String(e)));
            },
          },
        ]
      : []),
  ];
  return (
    <div
      className={`app ${compact ? "compact" : ""} ${collapsed ? "sidebar-collapsed" : ""}`}
    >
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        multiple
        {...({ webkitdirectory: "" } as Record<string, string>)}
        onChange={(e) => void importFolder(e.target.files)}
      />
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
        >
          <span className="brand-mark">
            <Skull size={24} strokeWidth={1.8} />
          </span>
          <div>
            ENV REAPER<span>CONFIGURATION, EXHUMED.</span>
          </div>
        </a>
        <button
          className="project-switcher"
          onClick={() => navigate("projects")}
        >
          <span className="project-icon">
            <FolderGit2 size={18} />
          </span>
          <div>
            <strong>{scan.name}</strong>
            <small>Local repository</small>
          </div>
          <ChevronDown size={14} />
        </button>
        <button
          aria-label="All projects"
          className={`nav-item projects-link ${view === "projects" ? "selected" : ""}`}
          onClick={() => navigate("projects")}
        >
          <FolderOpen size={17} />
          <span>All projects</span>
          <span className="nav-key">⌘ O</span>
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {navItems.map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              onClick={() => navigate(item.id)}
              className={`nav-item ${view === item.id ? "selected" : ""}`}
            >
              <item.icon size={17} />
              <span>{item.label}</span>
              {item.id === "dead" && dead > 0 ? (
                <span className="nav-count">{dead}</span>
              ) : item.id === "missing" && missing > 0 ? (
                <span className="nav-count amber">{missing}</span>
              ) : item.id === "secrets" && exposed > 0 ? (
                <span className="nav-count red">{exposed}</span>
              ) : item.shortcut ? (
                <span className="nav-key">⌘ {item.shortcut}</span>
              ) : null}
              {item.id === "graph" && <span className="new-label">NEW</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span>
              <i className="live-dot" />
              Local by nature.
            </span>
            <p>
              Your code stays on your machine.
              <br />
              Your secrets stay in the ground.
            </p>
            <ShieldCheck size={32} />
          </div>
          <button
            className={`nav-item ${view === "settings" ? "selected" : ""}`}
            aria-label="Settings"
            onClick={() => navigate("settings")}
          >
            <Settings2 size={17} />
            <span>Settings</span>
          </button>
          <button
            className="nav-item"
            aria-label="Help and shortcuts"
            onClick={() => setModal("help")}
          >
            <CircleHelp size={17} />
            <span>Help & shortcuts</span>
            <ExternalLink size={12} />
          </button>
          <div className="sidebar-version">
            <span>
              <span className="version-dot" /> v0.1.0{" "}
              <span className="muted">/ local-first</span>
            </span>
            <button
              className="icon-button"
              aria-label="Collapse sidebar"
              onClick={() => setCollapsed(!collapsed)}
            >
              <PanelLeftClose size={14} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            {collapsed && (
              <button
                className="icon-button"
                onClick={() => setCollapsed(false)}
                aria-label="Expand sidebar"
              >
                <PanelLeftClose size={17} />
              </button>
            )}
            <FolderGit2 size={15} />
            <button onClick={() => navigate("projects")}>{scan.name}</button>
            <ChevronRight size={12} />
            <span>{headings[view].title}</span>
          </div>
          <div className="topbar-right">
            <span className="local-indicator">
              <i className="live-dot" /> All systems local
            </span>
            <span className="topbar-divider" />
            <button
              className="command-trigger"
              onClick={() => {
                setCommandQuery("");
                setPalette(true);
              }}
            >
              <Search size={14} />
              <span>Quick find</span>
              <kbd>⌘ K</kbd>
            </button>
            <button
              className={`icon-button notification-trigger ${notice ? "active" : ""}`}
              aria-label="Show scan notifications"
              onClick={() => setNotice(!notice)}
            >
              <Bell size={17} />
              {(exposed > 0 || scan.warnings.length > 0) && <i />}
            </button>
            {notice && (
              <div className="notification-popover">
                <h3>Scan notes</h3>
                <p>
                  {scan.demo
                    ? "You’re exploring an illustrative demo. Open your own repository for real findings."
                    : `${scan.files} files analyzed locally.`}
                </p>
                {scan.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
                {exposed > 0 && (
                  <button
                    className="text-button"
                    onClick={() => {
                      navigate("secrets");
                      setNotice(false);
                    }}
                  >
                    Review {exposed} exposed secrets
                    <ArrowRight size={13} />
                  </button>
                )}
              </div>
            )}
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="live-dot" />
                {scan.demo ? "DEMO WORKSPACE" : "LOCAL WORKSPACE"}
                <span>/</span>
                <GitBranch size={12} />
                {scan.branch}
              </div>
              <h1>{headings[view].title}</h1>
              <p>{headings[view].description}</p>
            </div>
            <div className="heading-actions">
              {view === "projects" ? (
                <button
                  className="button primary"
                  onClick={() => void openProject()}
                >
                  <Plus size={16} />
                  Open repository
                </button>
              ) : (
                view !== "settings" && (
                  <>
                    <button
                      className="button export-button"
                      onClick={exportReport}
                    >
                      <ArrowDownToLine size={14} />
                      Export report
                    </button>
                    <button
                      className="button primary reap-button"
                      disabled={busy}
                      onClick={() => void runScan()}
                    >
                      <ScanLine size={16} className={busy ? "spin" : ""} />
                      {busy ? "Scanning…" : "Reap project"}
                    </button>
                  </>
                )
              )}
            </div>
          </div>
          {view !== "projects" && view !== "settings" && (
            <div className="repo-toolbar">
              <div>
                <span className="mono repo-path">
                  <FolderOpen size={13} />
                  {scan.path}
                </span>
                <span className="toolbar-dot">·</span>
                <span>{scan.files.toLocaleString()} files indexed</span>
                <span className="toolbar-dot">·</span>
                <span>
                  {busy
                    ? `Scanning ${progress ? progress + " files" : ""}…`
                    : `Scanned ${new Date(scan.scannedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                </span>
                <button
                  className="icon-button"
                  aria-label="Rescan repository"
                  disabled={busy}
                  onClick={() => void runScan()}
                >
                  <RefreshCw size={12} className={busy ? "spin" : ""} />
                </button>
              </div>
              <div>
                <select
                  aria-label="Repository service scope"
                  value={service}
                  onChange={(e) => setService(e.target.value)}
                >
                  <option value="all">All services</option>
                  {[...new Set(scan.variables.flatMap((v) => v.services))].map(
                    (s) => (
                      <option key={s}>{s}</option>
                    ),
                  )}
                </select>
                <span className="toolbar-separator" />
                <label
                  className="watch-toggle"
                  title={
                    native && !scan.demo
                      ? "Rescan every 15 seconds"
                      : "Open a real repository in the desktop app to watch changes"
                  }
                >
                  <button
                    role="switch"
                    aria-checked={watch}
                    aria-label="Watch mode"
                    onClick={() => {
                      if (native && !scan.demo) setWatch(!watch);
                      else
                        notify(
                          "Watch mode is available for local repositories in the desktop app.",
                        );
                    }}
                    className={`switch ${watch ? "on" : ""}`}
                  >
                    <span />
                  </button>
                  Watch mode
                </label>
              </div>
            </div>
          )}
          {busy && (
            <div className="scan-progress">
              <div />
            </div>
          )}
          {view === "overview" && (
            <Overview
              scan={scopedScan}
              onNavigate={navigate}
              onSelect={selectVariable}
            />
          )}
          {["variables", "dead", "missing", "secrets"].includes(view) && (
            <>
              {view === "dead" && (
                <div className="info-banner">
                  <Skull size={19} />
                  <div>
                    <strong>
                      {visibleVars.length} variables with no detected
                      references.
                    </strong>
                    <p>
                      Static analysis can’t see everything. Review dynamic usage
                      and external consumers before removing a definition.
                    </p>
                  </div>
                  <button className="button" onClick={() => setModal("reap")}>
                    Review cleanup
                    <ArrowRight size={14} />
                  </button>
                </div>
              )}
              {view === "missing" && (
                <div className="info-banner amber">
                  <TriangleAlert size={19} />
                  <div>
                    <strong>A name without a home.</strong>
                    <p>
                      Add empty placeholders for missing variables. Populate
                      real values yourself, locally.
                    </p>
                  </div>
                  <button
                    className="button"
                    onClick={() => setModal("example")}
                  >
                    <FilePlus2 size={14} />
                    Generate example
                  </button>
                </div>
              )}
              {view === "secrets" && (
                <div className="info-banner red">
                  <Flame size={19} />
                  <div>
                    <strong>
                      {exposed} probable secrets in Git-tracked files
                    </strong>
                    <p>
                      Removing a key from a file does not invalidate an exposed
                      credential. Review and rotate it with its provider.
                    </p>
                  </div>
                </div>
              )}
              <div className="section-title">
                <h3>
                  {view === "variables"
                    ? "All variables"
                    : headings[view].title}
                  <span className="tiny-label">{visibleVars.length}</span>
                </h3>
                <button
                  className="text-button"
                  onClick={() => setModal("example")}
                >
                  <FilePlus2 size={14} />
                  Generate .env.example
                </button>
              </div>
              <VariableTable
                key={view}
                variables={visibleVars}
                onSelect={selectVariable}
                view={view}
                query={query}
                setQuery={setQuery}
              />
            </>
          )}
          {view === "drift" && (
            <DriftView scan={scopedScan} onSelect={selectVariable} />
          )}
          {view === "graph" && (
            <GraphView scan={scopedScan} onSelect={selectVariable} />
          )}
          {view === "history" && <HistoryView history={history} scan={scan} />}
          {view === "projects" && (
            <ProjectsView
              projects={[...projects].sort(
                (a, b) => Number(!!b.pinned) - Number(!!a.pinned),
              )}
              onImport={() => void openProject()}
              onPin={(p) =>
                setProjects((prev) =>
                  prev.map((r) =>
                    r.path === p.path ? { ...r, pinned: !r.pinned } : r,
                  ),
                )
              }
              onOpen={(p) => {
                if (p.demo) {
                  sourceFiles.current = [];
                  acceptScan(demoScan());
                  navigate("overview");
                } else if (native) {
                  void runScan(p.path);
                  navigate("overview");
                } else if (p.path === scan.path) navigate("overview");
                else {
                  notify("Select this repository’s folder to restore access.");
                  void openProject();
                }
              }}
            />
          )}
          {view === "settings" && (
            <div className="settings-content">
              <section className="panel">
                <div className="section-title">
                  <h3>Your workspace</h3>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>Preferred editor</strong>
                    <p>Open source references in your favorite tool.</p>
                  </div>
                  <select
                    aria-label="Preferred editor"
                    value={editor}
                    onChange={(e) => setEditor(e.target.value)}
                  >
                    <option value="vscode">Visual Studio Code</option>
                    <option value="cursor">Cursor</option>
                    <option value="system">System file browser</option>
                  </select>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>Compact density</strong>
                    <p>A little more information. A little less space.</p>
                  </div>
                  <button
                    role="switch"
                    aria-label="Compact density"
                    aria-checked={compact}
                    className={`switch ${compact ? "on" : ""}`}
                    onClick={() => setCompact(!compact)}
                  >
                    <span />
                  </button>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>Local scan history</strong>
                    <p>
                      Only project paths, timestamps, and finding counts are
                      saved.
                    </p>
                  </div>
                  <button
                    className="button small"
                    onClick={() => {
                      setHistory([]);
                      notify("Local scan history cleared.");
                    }}
                  >
                    Clear history
                  </button>
                </div>
              </section>
              <section className="panel">
                <div className="section-title">
                  <h3>Scanner & privacy</h3>
                  <span className="tiny-label">LOCAL ONLY</span>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>Default exclusions</strong>
                    <p className="mono">
                      node_modules · .git · .next · dist · build · target ·
                      .venv · vendor
                    </p>
                  </div>
                  <ShieldCheck size={18} className="accent" />
                </div>
                <div className="setting-row">
                  <div>
                    <strong>Ignore files</strong>
                    <p>
                      {native
                        ? "Respects .gitignore and .ignore. Ignored .env files are intentionally inspected."
                        : "Browser imports skip generated directories. Use desktop for .gitignore, Git tracking, and filesystem writes."}
                    </p>
                  </div>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>Secret values</strong>
                    <p>
                      Never sent to a server, logged, or saved in application
                      history.
                    </p>
                  </div>
                  <span className="badge healthy">
                    <LockKeyhole size={11} />
                    Protected
                  </span>
                </div>
              </section>
              <button
                className="text-button"
                onClick={() => {
                  sourceFiles.current = [];
                  acceptScan(demoScan());
                  navigate("overview");
                }}
              >
                <Sparkles size={14} />
                Explore the demo repository
              </button>
            </div>
          )}
          <footer className="workspace-footer">
            <span>
              <ShieldCheck size={12} />
              No cloud. No telemetry. No loose ends.
            </span>
            <span>YOUR ENVIRONMENT VARIABLES HAVE A BODY COUNT.</span>
          </footer>
        </main>
        <div className="statusbar">
          <span>
            <i className="live-dot" />
            {busy ? "Analyzing repository…" : "Scanner ready"}
            <span className="status-separator">/</span>
            {native ? "Desktop engine" : "Browser workspace"}
            {scan.demo && <span className="status-demo">DEMO DATA</span>}
          </span>
          <span>
            <GitBranch size={12} />
            {scan.branch}
            <span className="status-separator">/</span>
            {scan.environments.length} environments
            <span className="status-separator">/</span>
            <LockKeyhole size={11} /> Local only
          </span>
        </div>
      </div>
      {selected && (
        <div className="inspector-backdrop" onClick={() => setSelected(null)}>
          <aside
            className="inspector"
            role="dialog"
            aria-modal="true"
            aria-label={`Variable ${selected.name}`}
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <span className="eyebrow">VARIABLE INSPECTOR</span>
              <button
                className="icon-button"
                aria-label="Close inspector"
                onClick={() => setSelected(null)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="inspector-body">
              <div className="inspector-title">
                <span className={`inspector-symbol ${selected.status}`}>
                  <FileCode2 size={25} />
                </span>
                <button
                  className="icon-button"
                  aria-label="Copy variable name"
                  onClick={() => void copy(selected.name)}
                >
                  <Copy size={15} />
                </button>
                <h2>{selected.name}</h2>
                <StatusBadge status={selected.status} />
                {selected.drifted && (
                  <span className="badge drifted">
                    <Workflow size={11} />
                    Drifted
                  </span>
                )}
              </div>
              <div className="inspector-summary">
                <div>
                  <span>REFERENCES</span>
                  <strong>{selected.references.length}</strong>
                </div>
                <div>
                  <span>CONFIDENCE</span>
                  <strong>{selected.confidence}%</strong>
                </div>
                <div>
                  <span>LAST SEEN</span>
                  <strong className="small-value">{selected.lastSeen}</strong>
                </div>
              </div>
              <section>
                <h4>
                  DEFINED IN <span>{selected.definitions.length}</span>
                </h4>
                {selected.definitions.length ? (
                  selected.definitions.map((d) => (
                    <div className="definition-row" key={d.file}>
                      <FileCode2 size={15} />
                      <div>
                        <strong className="mono">{d.file}</strong>
                        <small>
                          {d.tracked
                            ? "Git tracked"
                            : scan.gitAvailable
                              ? "Not Git tracked"
                              : "Git status unknown"}
                        </small>
                      </div>
                      <span className="masked-value">
                        {d.hasValue ? "••••••••" : "empty"}
                      </span>
                      {selected.status === "dead" && (
                        <button
                          className="text-button danger"
                          onClick={() =>
                            void prepareChange(d.file, "remove", selected.name)
                          }
                        >
                          Review
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="muted">No populated definition found.</p>
                )}
                {selected.status === "missing" && (
                  <button
                    className="button small"
                    onClick={() =>
                      void prepareChange(
                        scan.environments.find((e) =>
                          e.endsWith(".env.local"),
                        ) || ".env.local",
                        "placeholder",
                        selected.name,
                      )
                    }
                  >
                    <Plus size={13} />
                    Add placeholder to .env.local
                  </button>
                )}
              </section>
              <section>
                <h4>
                  REFERENCED BY <span>{selected.references.length}</span>
                </h4>
                {selected.references.length ? (
                  selected.references.slice(0, 20).map((r, i) => (
                    <div className="reference-card" key={r.file + r.line + i}>
                      <button
                        onClick={() => {
                          setFileToOpen(r);
                          setModal("open-file");
                        }}
                      >
                        <FileCode2 size={13} />
                        <span>
                          {r.file}
                          <b>:{r.line}</b>
                        </span>
                        <ExternalLink size={12} />
                      </button>
                      <code>
                        <span>{r.line}</span>
                        {r.pattern}
                      </code>
                    </div>
                  ))
                ) : (
                  <div className="no-references">
                    <Skull size={20} />
                    <p>
                      No source references detected.
                      <br />
                      <small>Check runtime configuration before removal.</small>
                    </p>
                  </div>
                )}
              </section>
              <section>
                <h4>SERVICES & PACKAGES</h4>
                <div className="service-tags">
                  {selected.services.length ? (
                    selected.services.map((s) => <span key={s}>{s}</span>)
                  ) : (
                    <span>No detected consumers</span>
                  )}
                </div>
              </section>
              <section>
                <h4>SECRET CLASSIFICATION</h4>
                <div className="classification">
                  <LockKeyhole size={17} />
                  <div>
                    <strong>
                      {selected.secret
                        ? selected.classification
                        : "Not classified as sensitive"}
                    </strong>
                    <p>
                      {selected.secret
                        ? "Value masked. Only metadata leaves the scanner."
                        : "Pattern matching is heuristic, not a security guarantee."}
                    </p>
                  </div>
                </div>
                {selected.status === "exposed" && (
                  <div className="inspector-warning">
                    <Flame size={16} />
                    <p>
                      A probable secret is in a tracked file. Rotate the
                      credential with its provider; deleting it does not revoke
                      access.
                    </p>
                  </div>
                )}
              </section>
              <section>
                <h4>GIT INTELLIGENCE</h4>
                <button
                  className="button small"
                  disabled={historyLoading}
                  onClick={() => void showHistory()}
                >
                  <GitBranch size={14} />
                  {historyLoading
                    ? "Reading history…"
                    : "Inspect commit history"}
                </button>
                {gitHistory && (
                  <div className="git-history">
                    {gitHistory.length ? (
                      gitHistory.map((c) => (
                        <div key={c.hash}>
                          <code>{c.hash.slice(0, 7)}</code>
                          <span>{c.date}</span>
                          <p>{c.subject}</p>
                        </div>
                      ))
                    ) : (
                      <p>No matching commits found in the available history.</p>
                    )}
                  </div>
                )}
              </section>
            </div>
            <footer>
              <ShieldCheck size={13} /> Static analysis. Human judgment.
            </footer>
          </aside>
        </div>
      )}
      {palette && (
        <Modal
          title="What are we unearthing?"
          onClose={() => setPalette(false)}
        >
          <div className="palette-search">
            <Search size={18} />
            <input
              autoFocus
              placeholder="Search commands or variables…"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "Enter") {
                  e.preventDefault();
                  const first = document.querySelector<HTMLButtonElement>(
                    ".command-list button",
                  );
                  if (e.key === "Enter") first?.click();
                  else first?.focus();
                }
              }}
              value={commandQuery}
              onChange={(e) => setCommandQuery(e.target.value)}
            />
            <kbd>ESC</kbd>
          </div>
          <div
            className="command-list"
            onKeyDown={(e) => {
              if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
              e.preventDefault();
              const buttons = Array.from(
                e.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
              );
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              buttons[
                (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                  buttons.length
              ]?.focus();
            }}
          >
            {commands
              .filter((c) =>
                c.label.toLowerCase().includes(commandQuery.toLowerCase()),
              )
              .map((c) => (
                <button key={c.label} onClick={c.action}>
                  <c.icon size={17} />
                  <span>{c.label}</span>
                  <ChevronRight size={14} />
                </button>
              ))}
            {commandQuery &&
              scan.variables
                .filter((v) =>
                  v.name.toLowerCase().includes(commandQuery.toLowerCase()),
                )
                .slice(0, 6)
                .map((v) => (
                  <button
                    key={v.name}
                    onClick={() => {
                      setPalette(false);
                      selectVariable(v);
                    }}
                  >
                    <FileCode2 size={16} />
                    <span className="mono">{v.name}</span>
                    <StatusBadge status={v.status} />
                  </button>
                ))}
          </div>
        </Modal>
      )}
      {modal === "example" && (
        <Modal
          title="A clean .env.example"
          subtitle="All detected active variables, grouped by service. No values are copied."
          onClose={() => setModal(null)}
          wide
        >
          <pre className="code-preview">{exampleText(scan)}</pre>
          <div className="modal-actions">
            <span>
              <LockKeyhole size={12} /> No secret values included
            </span>
            <button
              className="button"
              onClick={() => void copy(exampleText(scan))}
            >
              <Copy size={14} />
              Copy
            </button>
            <button
              className="button primary"
              onClick={() => void prepareChange(".env.example", "example")}
            >
              Review {native && !scan.demo ? "changes" : "download"}
              <ArrowRight size={14} />
            </button>
          </div>
        </Modal>
      )}
      {modal === "help" && (
        <Modal
          title="Meet your reaper."
          subtitle="A forensic workbench for your environment configuration."
          onClose={() => setModal(null)}
        >
          <div className="help-content">
            <p>
              Open a repository, run a scan, and follow the findings. Scanning
              never modifies source files. Desktop mode adds Git inspection,
              reviewed writes, and editor integration.
            </p>
            <div>
              <span>Command palette</span>
              <kbd>⌘ / Ctrl + K</kbd>
            </div>
            <div>
              <span>Search variables</span>
              <kbd>/</kbd>
            </div>
            <div>
              <span>Overview / Variables</span>
              <kbd>⌘ / Ctrl + 1 / 2</kbd>
            </div>
            <div>
              <span>Close inspector or dialog</span>
              <kbd>Esc</kbd>
            </div>
            <p className="muted">
              The initial Shipwreck repository is demo data. Browser imports
              stay in memory and cannot verify Git tracking. Use{" "}
              <code>npm run desktop</code> for the native workbench.
            </p>
          </div>
        </Modal>
      )}
      {modal === "reap" && (
        <Modal
          title="Review the departed"
          subtitle="Choose a variable to inspect its definitions and review a removal diff."
          onClose={() => setModal(null)}
        >
          <div
            className="command-list"
            onKeyDown={(e) => {
              if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
              e.preventDefault();
              const buttons = Array.from(
                e.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
              );
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              buttons[
                (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                  buttons.length
              ]?.focus();
            }}
          >
            {scan.variables
              .filter((v) => v.status === "dead")
              .map((v) => (
                <button
                  key={v.name}
                  onClick={() => {
                    setModal(null);
                    selectVariable(v);
                  }}
                >
                  <Skull size={17} />
                  <span className="mono">{v.name}</span>
                  <ChevronRight size={15} />
                </button>
              ))}
          </div>
          <p className="modal-note">
            Nothing is deleted automatically. No detected references does not
            guarantee that a variable is unused.
          </p>
        </Modal>
      )}
      {modal === "open-file" && fileToOpen && (
        <Modal
          title="Open source file?"
          subtitle="This file may contain sensitive values. Your editor may display them unmasked."
          onClose={() => setModal(null)}
        >
          <div className="open-file-path mono">
            {fileToOpen.file}:{fileToOpen.line}
          </div>
          <div className="modal-actions">
            <button className="button" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              className="button primary"
              onClick={async () => {
                setModal(null);
                if (native && !scan.demo) {
                  try {
                    await invoke("open_location", {
                      path: scan.path,
                      ...fileToOpen,
                      editor,
                    });
                  } catch (e) {
                    notify(String(e));
                  }
                } else {
                  await copy(`${fileToOpen.file}:${fileToOpen.line}`);
                  notify(
                    "Location copied. Opening files in an editor requires desktop mode.",
                  );
                }
              }}
            >
              {native && !scan.demo ? "Open in editor" : "Copy location"}
              <ExternalLink size={13} />
            </button>
          </div>
        </Modal>
      )}
      {review && (
        <Modal
          title="Review changes"
          subtitle={`${review.file} · ${review.token ? "Verify the diff before writing." : "Browser / demo mode — download only."}`}
          onClose={() => setReview(null)}
          wide
        >
          <div className="diff-label">
            <FileCode2 size={14} />
            {review.file}
            <span>VALUES REDACTED</span>
          </div>
          <pre className="diff-preview">
            {review.before && (
              <span className="removed">
                {review.before
                  .split("\n")
                  .map((l) => `− ${l.replace(/^[+-] /, "")}`)
                  .join("\n") + "\n"}
              </span>
            )}
            {review.after && (
              <span className="added">
                {review.after
                  .split("\n")
                  .map((l) => `+ ${l.replace(/^[+-] /, "")}`)
                  .join("\n")}
              </span>
            )}
          </pre>
          <div className="modal-actions">
            <span>Review external consumers before removal.</span>
            <button className="button" onClick={() => setReview(null)}>
              Cancel
            </button>
            <button
              className="button primary"
              onClick={() => void applyChange()}
            >
              {review.token ? "Apply changes" : "Download file"}
              <Check size={14} />
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div role="status" className="toast">
          <Check size={16} />
          <span>{toast}</span>
          {undoToken && (
            <button
              onClick={async () => {
                try {
                  await invoke("undo_change", { token: undoToken });
                  setUndoToken(null);
                  await runScan();
                  notify("Change undone.");
                } catch (e) {
                  notify(String(e));
                }
              }}
            >
              Undo
            </button>
          )}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
