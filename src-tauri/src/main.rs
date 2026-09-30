#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use regex::Regex;
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    process::Command,
    sync::Mutex,
};
use tauri::State;
#[derive(Clone)]
struct Change {
    root: PathBuf,
    path: PathBuf,
    before: Option<String>,
    after: String,
}
#[derive(Default)]
struct Session {
    changes: Mutex<HashMap<String, Change>>,
    undo: Mutex<HashMap<String, Change>>,
    roots: Mutex<Vec<PathBuf>>,
}
#[derive(Serialize)]
struct Preview {
    file: String,
    before: String,
    after: String,
    token: String,
}
fn authorize(state: &Session, path: &str) -> Result<PathBuf, String> {
    let path = Path::new(path)
        .canonicalize()
        .map_err(|_| "Folder is unavailable.")?;
    if !state
        .roots
        .lock()
        .map_err(|_| "Session unavailable.")?
        .contains(&path)
    {
        return Err("Open and scan this repository first.".into());
    }
    Ok(path)
}
fn scoped(root: &Path, file: &str) -> Result<PathBuf, String> {
    if file == "." {
        return Ok(root.to_path_buf());
    }
    let relative = Path::new(file);
    if relative.is_absolute()
        || relative
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_)))
    {
        return Err("Path must stay inside the repository.".into());
    }
    let path = root.join(relative);
    if path.exists() {
        let resolved = path.canonicalize().map_err(|_| "Cannot access file.")?;
        if !resolved.starts_with(root)
            || fs::symlink_metadata(&path)
                .map_err(|_| "Cannot inspect file.")?
                .file_type()
                .is_symlink()
        {
            return Err(
                "Symlink targets and paths outside the repository are not editable.".into(),
            );
        }
    } else {
        let parent = path
            .parent()
            .ok_or("Invalid file path.")?
            .canonicalize()
            .map_err(|_| "Parent folder does not exist.")?;
        if !parent.starts_with(root) {
            return Err("Path is outside the repository.".into());
        }
    }
    let parent = path
        .parent()
        .ok_or("Invalid file path.")?
        .canonicalize()
        .map_err(|_| "Cannot inspect parent.")?;
    Ok(parent.join(path.file_name().ok_or("Invalid file name.")?))
}
fn validate_change_path(change: &Change) -> Result<(), String> {
    let relative = change
        .path
        .strip_prefix(&change.root)
        .map_err(|_| "File is outside repository.")?;
    let resolved = scoped(&change.root, &relative.to_string_lossy())?;
    if resolved != change.path {
        return Err("File location changed. Review a new diff.".into());
    }
    Ok(())
}
fn redact(text: &str) -> String {
    let assignment = Regex::new(r"^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=)(.*)$").unwrap();
    let mut quote = None;
    text.lines()
        .map(|line| {
            if let Some(q) = quote {
                if env_reaper_core::closing_quote(line, q).is_some() {
                    quote = None;
                }
                return "<masked continuation>".into();
            }
            if let Some(c) = assignment.captures(line) {
                quote = env_reaper_core::open_quote(&c[2]);
                format!(
                    "{}{}",
                    &c[1],
                    if c[2].trim().is_empty() {
                        ""
                    } else {
                        "<masked>"
                    }
                )
            } else if line.trim().is_empty() {
                String::new()
            } else {
                "# <redacted content>".into()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}
fn remove_key(text: &str, name: &str) -> String {
    let assignment = Regex::new(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$").unwrap();
    let mut quote = None;
    let mut removing = false;
    let mut output = String::new();
    // Preserve original bytes (including line endings) for all unrelated definitions.
    for chunk in text.split_inclusive('\n') {
        let line = chunk.trim_end_matches(['\r', '\n']);
        if let Some(q) = quote {
            if !removing {
                output.push_str(chunk);
            }
            if env_reaper_core::closing_quote(line, q).is_some() {
                quote = None;
                removing = false;
            }
            continue;
        }
        if let Some(c) = assignment.captures(line) {
            removing = &c[1] == name;
            quote = env_reaper_core::open_quote(&c[2]);
            if removing {
                continue;
            }
        }
        output.push_str(chunk);
    }
    output
}
fn read_current(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("Could not read the environment file.".into()),
    }
}
fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid path.")?;
    let mut tmp =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "Cannot create a temporary file.")?;
    if let Ok(meta) = fs::metadata(path) {
        tmp.as_file()
            .set_permissions(meta.permissions())
            .map_err(|_| "Cannot preserve file permissions.")?;
    }
    tmp.write_all(text.as_bytes())
        .map_err(|_| "Could not write changes.")?;
    tmp.as_file()
        .sync_all()
        .map_err(|_| "Could not sync changes.")?;
    tmp.persist(path)
        .map_err(|_| "Could not replace the environment file.")?;
    Ok(())
}
#[tauri::command]
async fn scan_project(
    path: String,
    state: State<'_, Session>,
) -> Result<env_reaper_core::Scan, String> {
    let root = Path::new(&path)
        .canonicalize()
        .map_err(|_| "Folder is unavailable.")?;
    let scan_root = root.clone();
    let result = tauri::async_runtime::spawn_blocking(move || env_reaper_core::scan(&scan_root))
        .await
        .map_err(|_| "Scanner interrupted.")??;
    let mut roots = state.roots.lock().map_err(|_| "Session unavailable.")?;
    if !roots.contains(&root) {
        roots.push(root)
    }
    Ok(result)
}
#[tauri::command]
async fn variable_history(
    path: String,
    name: String,
    state: State<'_, Session>,
) -> Result<Vec<env_reaper_core::Commit>, String> {
    let root = authorize(&state, &path)?;
    tauri::async_runtime::spawn_blocking(move || env_reaper_core::variable_history(&root, &name))
        .await
        .map_err(|_| "History task interrupted.")?
}
#[tauri::command]
fn preview_change(
    path: String,
    file: String,
    operation: String,
    name: Option<String>,
    state: State<'_, Session>,
) -> Result<Preview, String> {
    let root = authorize(&state, &path)?;
    if !env_reaper_core::is_env(&file) {
        return Err("Only environment files can be edited by this workflow.".into());
    }
    let target = scoped(&root, &file)?;
    let before = read_current(&target)?;
    let original = before.as_deref().unwrap_or("");
    let after = match operation.as_str() {
        "example" => {
            if file != ".env.example" {
                return Err("Example output must be .env.example.".into());
            }
            env_reaper_core::example(&env_reaper_core::scan(&root)?)
        }
        "remove" | "placeholder" => {
            let name = name.ok_or("Missing variable name.")?;
            if !Regex::new(r"^[A-Za-z_][A-Za-z0-9_]*$")
                .unwrap()
                .is_match(&name)
            {
                return Err("Invalid variable name.".into());
            }
            if operation == "remove" {
                remove_key(original, &name)
            } else {
                let re = Regex::new(&format!(
                    r"(?m)^\s*(?:export\s+)?{}\s*=",
                    regex::escape(&name)
                ))
                .unwrap();
                if re.is_match(original) {
                    return Err(
                        "This key already exists. Edit its empty value in your editor.".into(),
                    );
                }
                format!(
                    "{original}{}{name}=\n",
                    if !original.is_empty() && !original.ends_with('\n') {
                        "\n"
                    } else {
                        ""
                    }
                )
            }
        }
        _ => return Err("Unknown change operation.".into()),
    };
    if original == after {
        return Err("No changes to apply.".into());
    }
    let token = uuid::Uuid::new_v4().to_string();
    let preview = Preview {
        file,
        before: redact(original),
        after: redact(&after),
        token: token.clone(),
    };
    let mut changes = state.changes.lock().map_err(|_| "Session unavailable.")?;
    changes.clear();
    changes.insert(
        token,
        Change {
            root,
            path: target,
            before,
            after,
        },
    );
    Ok(preview)
}
#[tauri::command]
fn apply_change(token: String, state: State<'_, Session>) -> Result<String, String> {
    apply_preview(token, &state)
}
fn apply_preview(token: String, state: &Session) -> Result<String, String> {
    let mut changes = state.changes.lock().map_err(|_| "Session unavailable.")?;
    let change = changes
        .get(&token)
        .ok_or("Change preview expired. Review again.")?
        .clone();
    if fs::symlink_metadata(&change.path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("The file became a symlink. Review again.".into());
    }
    validate_change_path(&change)?;
    if read_current(&change.path)? != change.before {
        return Err("File changed since preview. Review a fresh diff before applying.".into());
    }
    write_atomic(&change.path, &change.after)?;
    changes.remove(&token);
    let undo_token = uuid::Uuid::new_v4().to_string();
    let mut undo = state.undo.lock().map_err(|_| "Session unavailable.")?;
    undo.clear();
    undo.insert(undo_token.clone(), change);
    Ok(undo_token)
}
#[tauri::command]
fn undo_change(token: String, state: State<'_, Session>) -> Result<(), String> {
    undo_preview(token, &state)
}
fn undo_preview(token: String, state: &Session) -> Result<(), String> {
    let mut undo = state.undo.lock().map_err(|_| "Session unavailable.")?;
    let change = undo.get(&token).ok_or("Undo has expired.")?;
    if fs::symlink_metadata(&change.path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("Cannot undo a symlink.".into());
    }
    validate_change_path(change)?;
    if read_current(&change.path)?.as_deref() != Some(&change.after) {
        return Err("File changed after applying. Undo would overwrite your edits.".into());
    }
    if let Some(before) = &change.before {
        write_atomic(&change.path, before)?
    } else {
        fs::remove_file(&change.path).map_err(|_| "Unable to remove the created file.")?
    }
    undo.remove(&token);
    Ok(())
}
#[tauri::command]
fn open_location(
    path: String,
    file: String,
    line: usize,
    editor: String,
    state: State<'_, Session>,
) -> Result<(), String> {
    let root = authorize(&state, &path)?;
    let target = scoped(&root, &file)?;
    let mut command = match editor.as_str() {
        "vscode" | "cursor" => {
            let mut c = Command::new(if editor == "cursor" { "cursor" } else { "code" });
            c.arg("--goto")
                .arg(format!("{}:{}", target.display(), line));
            c
        }
        "system" => {
            #[cfg(target_os = "macos")]
            let mut c = Command::new("open");
            #[cfg(target_os = "windows")]
            let mut c = Command::new("explorer");
            #[cfg(target_os = "linux")]
            let mut c = Command::new("xdg-open");
            c.arg(if target.is_dir() {
                target
            } else {
                target.parent().unwrap_or(&root).to_path_buf()
            });
            c
        }
        "terminal" => {
            #[cfg(target_os = "macos")]
            let mut c = {
                let mut c = Command::new("open");
                c.args(["-a", "Terminal"]).arg(&root);
                c
            };
            #[cfg(target_os = "windows")]
            let mut c = {
                let mut c = Command::new("cmd");
                c.arg("/C").arg("start").arg("cmd").current_dir(&root);
                c
            };
            #[cfg(target_os = "linux")]
            let mut c = {
                let mut c = Command::new("x-terminal-emulator");
                c.current_dir(&root);
                c
            };
            c.current_dir(&root);
            c
        }
        _ => return Err("Unsupported editor.".into()),
    };
    command.spawn().map_err(|_| {
        "Could not open the editor. Check that its command-line launcher is installed."
    })?;
    Ok(())
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Session::default())
        .invoke_handler(tauri::generate_handler![
            scan_project,
            variable_history,
            preview_change,
            apply_change,
            undo_change,
            open_location
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start Env Reaper");
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remove_multiline_preserves_other_content() {
        assert_eq!(
            remove_key("# comment\r\nKEY=\"one\r\ntwo\"\r\nKEEP=yes\r\n", "KEY"),
            "# comment\r\nKEEP=yes\r\n"
        );
    }
    #[test]
    fn removal_handles_trailing_comments_and_preserves_embedded_keys() {
        assert_eq!(
            remove_key("KEY=\"one\" # note\nKEEP=yes\n", "KEY"),
            "KEEP=yes\n"
        );
        let input = "OTHER=\"multi\nKEY=embedded\nlast\" # comment\nKEY=real\nKEEP=yes";
        assert_eq!(
            remove_key(input, "KEY"),
            "OTHER=\"multi\nKEY=embedded\nlast\" # comment\nKEEP=yes"
        );
    }
    #[test]
    fn redacts_all_values_and_comments() {
        let text = redact("TOKEN=secret\n# secret comment\ncontinuation\nEMPTY=");
        assert!(!text.contains("secret"));
        assert!(!text.contains("continuation"));
        assert!(text.contains("EMPTY="));
    }
    #[test]
    fn paths_cannot_escape() {
        let root = tempfile::tempdir().unwrap();
        assert!(scoped(root.path(), "../outside").is_err());
        assert!(scoped(root.path(), "/tmp/outside").is_err());
    }
    #[test]
    fn atomic_write_preserves_permissions() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".env");
        fs::write(&path, "A=old").unwrap();
        write_atomic(&path, "A=new").unwrap();
        assert_eq!(fs::read_to_string(path).unwrap(), "A=new");
    }
    #[test]
    fn preview_rejects_external_edits_and_undo_preserves_new_work() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let path = root.join(".env.local");
        fs::write(&path, "KEY=original\n").unwrap();
        let session = Session::default();
        session.changes.lock().unwrap().insert(
            "preview".into(),
            Change {
                root,
                path: path.clone(),
                before: Some("KEY=original\n".into()),
                after: "KEY=new\n".into(),
            },
        );
        fs::write(&path, "KEY=external-edit\n").unwrap();
        assert!(apply_preview("preview".into(), &session).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "KEY=external-edit\n");
        fs::write(&path, "KEY=original\n").unwrap();
        let undo = apply_preview("preview".into(), &session).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "KEY=new\n");
        fs::write(&path, "KEY=edit-after-apply\n").unwrap();
        assert!(undo_preview(undo.clone(), &session).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "KEY=edit-after-apply\n");
        fs::write(&path, "KEY=new\n").unwrap();
        undo_preview(undo, &session).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "KEY=original\n");
    }
    #[test]
    fn undo_new_file_removes_only_the_created_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let path = root.join(".env.example");
        let session = Session::default();
        session.changes.lock().unwrap().insert(
            "new".into(),
            Change {
                root,
                path: path.clone(),
                before: None,
                after: "API_KEY=\n".into(),
            },
        );
        let undo = apply_preview("new".into(), &session).unwrap();
        assert!(path.exists());
        undo_preview(undo, &session).unwrap();
        assert!(!path.exists());
    }
    #[cfg(unix)]
    #[test]
    fn symlink_swap_cannot_redirect_a_preview() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let path = root.join(".env");
        let target = outside.path().join(".env");
        fs::write(&target, "KEEP=external").unwrap();
        let session = Session::default();
        session.changes.lock().unwrap().insert(
            "change".into(),
            Change {
                root,
                path: path.clone(),
                before: None,
                after: "REPLACED=\n".into(),
            },
        );
        symlink(&target, &path).unwrap();
        assert!(apply_preview("change".into(), &session).is_err());
        assert_eq!(fs::read_to_string(target).unwrap(), "KEEP=external");
    }
}
