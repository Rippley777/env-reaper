use ignore::{overrides::OverrideBuilder, WalkBuilder};
use rayon::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::Instant,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    pub file: String,
    pub line: usize,
    pub pattern: String,
    pub service: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Definition {
    pub file: String,
    pub has_value: bool,
    pub tracked: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Variable {
    pub name: String,
    pub status: String,
    pub secret: bool,
    pub classification: String,
    pub definitions: Vec<Definition>,
    pub references: Vec<Reference>,
    pub services: Vec<String>,
    pub drifted: bool,
    pub last_seen: String,
    pub confidence: u8,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scan {
    pub name: String,
    pub path: String,
    pub branch: String,
    pub variables: Vec<Variable>,
    pub files: usize,
    pub duration: f64,
    pub scanned_at: String,
    pub environments: Vec<String>,
    pub warnings: Vec<String>,
    pub git_available: bool,
}
#[derive(Debug, Clone, Serialize)]
pub struct Commit {
    pub hash: String,
    pub date: String,
    pub subject: String,
}
#[derive(Clone)]
struct Input {
    path: String,
    text: String,
    tracked: bool,
}

fn variable(name: &str) -> Variable {
    Variable {
        name: name.into(),
        status: "unknown".into(),
        secret: false,
        classification: String::new(),
        definitions: vec![],
        references: vec![],
        services: vec![],
        drifted: false,
        last_seen: "Just now".into(),
        confidence: 95,
    }
}
fn git(root: &Path, args: &[&str]) -> Option<Vec<u8>> {
    Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| o.stdout)
}
pub fn is_env(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    name == ".env" || name.starts_with(".env.")
}
fn supported(path: &str) -> bool {
    if is_env(path)
        || path.ends_with(".npmrc")
        || path
            .rsplit('/')
            .next()
            .unwrap_or("")
            .starts_with("Dockerfile")
    {
        return true;
    }
    matches!(
        path.rsplit('.').next().unwrap_or(""),
        "js" | "jsx"
            | "mjs"
            | "cjs"
            | "ts"
            | "tsx"
            | "py"
            | "rs"
            | "go"
            | "cs"
            | "java"
            | "rb"
            | "php"
            | "sh"
            | "bash"
            | "zsh"
            | "yml"
            | "yaml"
            | "toml"
            | "json"
            | "tf"
            | "ini"
            | "conf"
            | "properties"
    )
}
fn secret_class(name: &str, value: &str) -> Option<String> {
    let key = name.to_uppercase();
    if [
        "PASSWORD",
        "PASSWD",
        "SECRET",
        "TOKEN",
        "PRIVATE_KEY",
        "API_KEY",
        "ACCESS_KEY",
        "CREDENTIAL",
        "DATABASE_URL",
        "REDIS_URL",
    ]
    .iter()
    .any(|s| key.contains(s))
    {
        return Some(
            if key.contains("URL") {
                "Connection string"
            } else if key.contains("SECRET") {
                "Signing secret"
            } else {
                "API credential"
            }
            .into(),
        );
    }
    if [
        "sk-live-",
        "sk_live_",
        "sk-proj-",
        "ghp_",
        "gho_",
        "github_pat_",
        "AKIA",
        "-----BEGIN",
    ]
    .iter()
    .any(|s| value.contains(s))
    {
        return Some("Credential pattern".into());
    }
    if value.contains("://")
        && value.contains('@')
        && value
            .split("://")
            .nth(1)
            .unwrap_or("")
            .split('@')
            .next()
            .unwrap_or("")
            .contains(':')
    {
        return Some("Connection string".into());
    }
    if value.len() > 24
        && !value.contains("://")
        && !value.chars().any(char::is_whitespace)
        && value.chars().any(|c| c.is_ascii_uppercase())
        && value.chars().any(|c| c.is_ascii_lowercase())
        && value.chars().any(|c| c.is_ascii_digit())
    {
        let mut freq = BTreeMap::new();
        for c in value.chars() {
            *freq.entry(c).or_insert(0usize) += 1;
        }
        let len = value.chars().count() as f64;
        let entropy: f64 = freq
            .values()
            .map(|n| {
                let p = *n as f64 / len;
                -p * p.log2()
            })
            .sum();
        if entropy > 4.3 {
            return Some("High-entropy value".into());
        }
    }
    None
}
fn patterns() -> Vec<Regex> {
    [
 r"(?:process\.env|import\.meta\.env)\.([A-Z_][A-Z0-9_]*)",
 r#"(?:process\.env|import\.meta\.env|os\.environ)\s*\[\s*["']([A-Z_][A-Z0-9_]*)["']\s*\]"#,
 r#"(?:Deno\.env\.get|os\.getenv|os\.environ\.get|(?:std::)?env::var|(?:option_)?env!|os\.Getenv|Environment\.GetEnvironmentVariable|configuration\.GetValue(?:<[^>]+>)?)\s*\(\s*["']([A-Z_][A-Z0-9_]*)["']"#,
 r"\$\{([A-Z_][A-Z0-9_]*)(?:[^}]*)\}",r"\$([A-Z_][A-Z0-9_]*)",r"(?:secrets|vars|env)\.([A-Z_][A-Z0-9_]*)",
 r#"(?:configuration|Configuration)\s*\[\s*["']([A-Z_][A-Z0-9_]*)["']"#
 ].iter().map(|s|Regex::new(s).unwrap()).collect()
}

pub fn scan(root: &Path) -> Result<Scan, String> {
    let start = Instant::now();
    let root = root
        .canonicalize()
        .map_err(|_| "Repository folder cannot be accessed.")?;
    if !root.is_dir() {
        return Err("Select a repository directory.".into());
    }
    let tracked_output = git(&root, &["ls-files", "-z"]);
    let git_available = tracked_output.is_some();
    let tracked: HashSet<String> = tracked_output
        .unwrap_or_default()
        .split(|b| *b == 0)
        .filter_map(|p| String::from_utf8(p.to_vec()).ok())
        .collect();
    let branch = git(&root, &["rev-parse", "--abbrev-ref", "HEAD"])
        .and_then(|b| String::from_utf8(b).ok())
        .unwrap_or_else(|| "local".into())
        .trim()
        .to_owned();
    let mut overrides = OverrideBuilder::new(&root);
    overrides.add(".env*").map_err(|e| e.to_string())?;
    for dir in [
        "node_modules",
        ".git",
        ".next",
        "dist",
        "build",
        "target",
        ".venv",
        "venv",
        "vendor",
        "coverage",
        "__pycache__",
    ] {
        overrides
            .add(&format!("!**/{dir}/**"))
            .map_err(|e| e.to_string())?;
        overrides
            .add(&format!("!**/{dir}"))
            .map_err(|e| e.to_string())?;
    }
    let overrides = overrides.build().map_err(|e| e.to_string())?;
    // A whitelist override alone filters source files; whitelist all, then let ignore files govern source traversal.
    let mut paths: BTreeSet<PathBuf> = BTreeSet::new();
    let mut warnings = vec![];
    let excluded_dirs = [
        "node_modules",
        ".git",
        ".next",
        "dist",
        "build",
        "target",
        ".venv",
        "venv",
        "vendor",
        "coverage",
        "__pycache__",
    ];
    let normal = WalkBuilder::new(&root)
        .hidden(false)
        .follow_links(false)
        .filter_entry(move |e| {
            !e.file_type().is_some_and(|t| t.is_dir())
                || !excluded_dirs.contains(&e.file_name().to_str().unwrap_or(""))
        })
        .build();
    for entry in normal {
        match entry {
            Ok(e) => {
                if e.file_type().is_some_and(|t| t.is_file()) {
                    paths.insert(e.path().to_owned());
                }
            }
            Err(_) => warnings.push("Some paths could not be read.".into()),
        }
    }
    // Include ignored environment definitions without walking generated directories or following symlinks.
    for entry in WalkBuilder::new(&root)
        .hidden(false)
        .follow_links(false)
        .overrides(overrides)
        .build()
        .flatten()
    {
        if entry.file_type().is_some_and(|t| t.is_file()) && is_env(&entry.path().to_string_lossy())
        {
            paths.insert(entry.path().to_owned());
        }
    }
    let inputs: Vec<Input> = paths
        .par_iter()
        .filter_map(|path| {
            let rel = path
                .strip_prefix(&root)
                .ok()?
                .to_string_lossy()
                .replace('\\', "/");
            if !supported(&rel) || fs::metadata(path).ok()?.len() > 2_000_000 {
                return None;
            }
            let bytes = fs::read(path).ok()?;
            if bytes.contains(&0) {
                return None;
            }
            let text = String::from_utf8(bytes).ok()?;
            Some(Input {
                tracked: tracked.contains(&rel),
                path: rel,
                text,
            })
        })
        .collect();
    let files = inputs.len();
    let (variables, environments, mut findings) = analyze(&inputs);
    warnings.append(&mut findings);
    if !git_available {
        warnings.push("Git tracking and commit history are unavailable for this folder.".into())
    }
    warnings.push("Static analysis may miss dynamic access and external consumers. Review before removing definitions.".into());
    Ok(Scan {
        name: root
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
        path: root.to_string_lossy().into(),
        branch,
        variables,
        files,
        duration: start.elapsed().as_secs_f64(),
        scanned_at: chrono::Utc::now().to_rfc3339(),
        environments,
        warnings,
        git_available,
    })
}
/// Find a closing quote without mistaking an escaped quote for a terminator.
pub fn closing_quote(text: &str, quote: char) -> Option<usize> {
    let mut escaped = false;
    for (i, ch) in text.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if ch == quote {
            return Some(i);
        }
        if ch == '\\' && quote == '"' {
            escaped = true;
        }
    }
    None
}
pub fn open_quote(value: &str) -> Option<char> {
    let value = value.trim_start();
    let quote = value.chars().next()?;
    if (quote == '\'' || quote == '"') && closing_quote(&value[1..], quote).is_none() {
        Some(quote)
    } else {
        None
    }
}
fn value_is_present(value: &str) -> bool {
    let value = value.trim();
    if value.starts_with('"') || value.starts_with('\'') {
        let rest = &value[1..];
        closing_quote(rest, value.chars().next().unwrap()).is_none_or(|end| end > 0)
    } else {
        !value.split('#').next().unwrap_or("").trim().is_empty()
    }
}
fn analyze(inputs: &[Input]) -> (Vec<Variable>, Vec<String>, Vec<String>) {
    let mut vars: BTreeMap<String, Variable> = BTreeMap::new();
    let mut envs = BTreeSet::new();
    let mut warnings = vec![];
    let regexes = patterns();
    let assignment = Regex::new(r"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$").unwrap();
    let source_assignment=Regex::new(r#"(?:^|\s)(?:ENV\s+|ARG\s+|(?:const|let|var)\s+)?([A-Z_][A-Z0-9_]*)\s*(?:=|:)\s*["']([^"']*)["']"#).unwrap();
    let destructure =
        Regex::new(r"\{\s*([^{}]+)\}\s*=\s*(?:process\.env|import\.meta\.env)").unwrap();
    let valid_key = Regex::new(r"^[A-Z_][A-Z0-9_]*$").unwrap();
    for input in inputs {
        let env = is_env(&input.path);
        let example = [".example", ".sample", ".template"]
            .iter()
            .any(|suffix| input.path.ends_with(suffix));
        if env && !example {
            envs.insert(input.path.clone());
        }
        let parts: Vec<&str> = input.path.split('/').collect();
        let service = parts
            .windows(2)
            .find(|w| ["apps", "packages", "services"].contains(&w[0]))
            .map(|w| w[1])
            .unwrap_or("root");
        let mut quote = None;
        for (index, line) in input.text.lines().enumerate() {
            let line = line.trim();
            if let Some(q) = quote {
                if closing_quote(line, q).is_some() {
                    quote = None
                }
                continue;
            }
            if line.is_empty()
                || line.starts_with('#')
                || line.starts_with("//")
                || line.starts_with('*')
            {
                continue;
            }
            if env {
                if let Some(c) = assignment.captures(line) {
                    let name = &c[1];
                    let value = &c[2];
                    quote = open_quote(value);
                    let v = vars.entry(name.into()).or_insert_with(|| variable(name));
                    if !example {
                        if v.definitions.iter().any(|d| d.file == input.path) {
                            warnings.push(format!(
                                "Duplicate {name} in {}:{}",
                                input.path,
                                index + 1
                            ))
                        } else {
                            v.definitions.push(Definition {
                                file: input.path.clone(),
                                has_value: value_is_present(value),
                                tracked: input.tracked,
                            });
                        }
                    }
                    if let Some(class) = secret_class(name, value) {
                        v.secret = true;
                        v.classification = class;
                    }
                } else {
                    warnings.push(format!(
                        "Unrecognized assignment in {}:{}",
                        input.path,
                        index + 1
                    ));
                }
            } else if let Some(c) = source_assignment.captures(line) {
                if let Some(class) = secret_class(&c[1], &c[2]) {
                    let v = vars.entry(c[1].into()).or_insert_with(|| variable(&c[1]));
                    v.secret = true;
                    v.classification = class;
                    if !v.definitions.iter().any(|d| d.file == input.path) {
                        v.definitions.push(Definition {
                            file: input.path.clone(),
                            has_value: !c[2].is_empty(),
                            tracked: input.tracked,
                        });
                    }
                }
            }
            if example {
                continue;
            }
            let mut references: Vec<(String, String)> = vec![];
            for re in &regexes {
                for c in re.captures_iter(line) {
                    references.push((c[1].to_owned(), c[0].to_owned()));
                }
            }
            if let Some(c) = destructure.captures(line) {
                for field in c[1].split(',') {
                    let key = field.split([':', '=']).next().unwrap_or("").trim();
                    if valid_key.is_match(key) {
                        references.push((key.into(), format!("{{ {key} }} = process.env")));
                    }
                }
            }
            for (name, pattern) in references {
                let v = vars.entry(name.clone()).or_insert_with(|| variable(&name));
                if !v
                    .references
                    .iter()
                    .any(|r| r.file == input.path && r.line == index + 1)
                {
                    v.references.push(Reference {
                        file: input.path.clone(),
                        line: index + 1,
                        pattern,
                        service: service.into(),
                    });
                    if !v.services.contains(&service.to_owned()) {
                        v.services.push(service.into())
                    }
                }
            }
        }
    }
    let variables = vars
        .into_values()
        .filter(|v| !v.definitions.is_empty() || !v.references.is_empty())
        .map(|mut v| {
            if let Some(class) = secret_class(&v.name, "") {
                v.secret = true;
                v.classification = class;
            }
            v.status = if v.secret && v.definitions.iter().any(|d| d.tracked) {
                "exposed"
            } else if v.references.is_empty() {
                "dead"
            } else if !v.definitions.iter().any(|d| d.has_value) {
                "missing"
            } else {
                "healthy"
            }
            .into();
            let definitions = v
                .definitions
                .iter()
                .filter(|d| envs.contains(&d.file))
                .count();
            v.drifted = definitions > 0 && definitions < envs.len();
            if v.references.is_empty() {
                v.last_seen = "No reference".into()
            }
            v
        })
        .collect();
    (variables, envs.into_iter().collect(), warnings)
}
pub fn example(scan: &Scan) -> String {
    let mut groups: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for v in scan.variables.iter().filter(|v| v.status != "dead") {
        groups
            .entry(v.services.first().map(String::as_str).unwrap_or("shared"))
            .or_default()
            .push(&v.name);
    }
    let mut result=String::from("# Generated by Env Reaper. Values intentionally omitted.\n# Populate credentials locally; never commit real secrets.\n\n");
    for (group, names) in groups {
        result.push_str(&format!("# {}\n", group.to_uppercase()));
        for name in names {
            result.push_str(&format!("{name}=\n"))
        }
        result.push('\n')
    }
    result
}
pub fn variable_history(root: &Path, name: &str) -> Result<Vec<Commit>, String> {
    if !Regex::new(r"^[A-Za-z_][A-Za-z0-9_]*$")
        .unwrap()
        .is_match(name)
    {
        return Err("Invalid variable name.".into());
    }
    let out = git(
        root,
        &[
            "log",
            "--all",
            "-n",
            "40",
            "--format=%H%x09%cs",
            &format!("-G{name}"),
            "--",
            ".",
        ],
    )
    .ok_or("Git history unavailable.")?;
    Ok(String::from_utf8_lossy(&out)
        .lines()
        .filter_map(|line| {
            let mut fields = line.splitn(2, '\t');
            Some(Commit {
                hash: fields.next()?.into(),
                date: fields.next()?.into(),
                subject: "Variable reference changed".into(),
            })
        })
        .collect())
}
pub fn health(scan: &Scan) -> u8 {
    if scan.variables.is_empty() {
        return 100;
    }
    let weight:f64=scan.variables.iter().map(|v|match v.status.as_str(){"exposed"=>2.,"missing"=>1.3,"dead"=>0.45,_=>0.}+if v.drifted{0.25}else{0.}).sum();
    (100. - weight / scan.variables.len() as f64 * 100.)
        .round()
        .max(0.) as u8
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    fn input(path: &str, text: &str, tracked: bool) -> Input {
        Input {
            path: path.into(),
            text: text.into(),
            tracked,
        }
    }
    #[test]
    fn classifies_without_exposing_values() {
        let (v, _, _) = analyze(&[
            input(
                ".env.local",
                "DATABASE_URL=postgres://user:password@host/db\nUNUSED=old\nEMPTY=",
                false,
            ),
            input(
                "apps/api/main.ts",
                "process.env.DATABASE_URL; process.env.MISSING; process.env.EMPTY",
                false,
            ),
        ]);
        assert_eq!(
            v.iter().find(|v| v.name == "UNUSED").unwrap().status,
            "dead"
        );
        assert_eq!(
            v.iter().find(|v| v.name == "MISSING").unwrap().status,
            "missing"
        );
        assert_eq!(
            v.iter().find(|v| v.name == "EMPTY").unwrap().status,
            "missing"
        );
        let output = serde_json::to_string(&v).unwrap();
        assert!(!output.contains("password@"));
        assert!(v.iter().find(|v| v.name == "DATABASE_URL").unwrap().secret);
    }
    #[test]
    fn detects_multilanguage_and_ignores_example_values() {
        let (v, _, _) = analyze(&[
            input(".env.example", "KEY=not-a-real-value", true),
            input("main.py", "os.getenv('KEY')\nos.environ[\"OTHER\"]", false),
            input(
                "main.rs",
                "std::env::var(\"RUST_KEY\"); env!(\"BUILD_KEY\")",
                false,
            ),
            input("main.go", "os.Getenv(\"GO_KEY\")", false),
        ]);
        assert_eq!(v.len(), 5);
        assert!(v.iter().all(|v| v.status == "missing"));
    }
    #[test]
    fn multiline_values_are_not_treated_as_keys() {
        let (v, _, w) = analyze(&[input(
            ".env",
            "PRIVATE_KEY=\"first\nFAKE=still inside\nlast\"\nREAL=yes\nREAL=no",
            false,
        )]);
        assert_eq!(v.len(), 2);
        assert_eq!(w.len(), 1);
        assert!(!v.iter().any(|v| v.name == "FAKE"));
    }
    #[test]
    fn respects_gitignore_and_generated_dirs_but_reads_env() {
        let dir = tempdir().unwrap();
        Command::new("git")
            .arg("init")
            .arg(dir.path())
            .output()
            .unwrap();
        fs::write(dir.path().join(".gitignore"), "ignored.ts\n.env.local\n").unwrap();
        fs::write(dir.path().join("ignored.ts"), "process.env.IGNORED").unwrap();
        fs::write(dir.path().join("index.ts"), "process.env.TOKEN").unwrap();
        fs::write(dir.path().join(".env.local"), "TOKEN=sensitive-value").unwrap();
        fs::create_dir(dir.path().join("node_modules")).unwrap();
        fs::write(dir.path().join("node_modules/.env"), "BAD=yes").unwrap();
        let s = scan(dir.path()).unwrap();
        assert_eq!(s.variables.len(), 1);
        assert_eq!(s.variables[0].name, "TOKEN");
        assert_eq!(s.variables[0].status, "healthy");
        assert_eq!(s.files, 2);
    }
    #[test]
    fn tracked_secrets_are_exposed_and_examples_are_empty() {
        let (v, _, _) = analyze(&[input(
            ".env",
            "OPENAI_API_KEY=sk-proj-super-sensitive\nPORT=3000",
            true,
        )]);
        assert_eq!(
            v.iter()
                .find(|v| v.name == "OPENAI_API_KEY")
                .unwrap()
                .status,
            "exposed"
        );
    }
    #[test]
    fn destructuring_and_source_credentials() {
        let(v,_,_)=analyze(&[input("index.ts","const { DATABASE_URL, NODE_ENV: mode } = process.env;\nconst API_KEY = 'ghp_sensitive';",true)]);
        assert_eq!(v.len(), 3);
        assert_eq!(
            v.iter().find(|v| v.name == "API_KEY").unwrap().status,
            "exposed"
        );
        assert!(
            v.iter()
                .find(|v| v.name == "DATABASE_URL")
                .unwrap()
                .references
                .len()
                > 0
        );
    }
}
