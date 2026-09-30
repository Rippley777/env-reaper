use std::path::Path;
fn main() {
    if let Err(e) = run() {
        eprintln!("Env Reaper: {e}");
        std::process::exit(1)
    }
}
fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|s| s == "--help" || s == "-h") {
        println!("envreaper <scan|dead|missing|secrets|drift|graph|example> [repository] [--json]\n\nLocal analysis only. Values are never printed. Example writes to stdout.");
        return Ok(());
    }
    let cmd = args.first().map(String::as_str).unwrap_or("scan");
    if ![
        "scan", "dead", "missing", "secrets", "drift", "graph", "example",
    ]
    .contains(&cmd)
    {
        return Err("Unknown command. Use --help.".into());
    }
    let path = args
        .iter()
        .skip(1)
        .find(|a| !a.starts_with('-'))
        .map(String::as_str)
        .unwrap_or(".");
    let mut scan = env_reaper_core::scan(Path::new(path))?;
    match cmd {
        "example" => {
            print!("{}", env_reaper_core::example(&scan));
            return Ok(());
        }
        "dead" | "missing" => scan.variables.retain(|v| v.status == cmd),
        "secrets" => scan.variables.retain(|v| v.secret),
        "drift" => scan.variables.retain(|v| v.drifted),
        _ => {}
    }
    if args.iter().any(|a| a == "--json") || cmd == "graph" {
        println!(
            "{}",
            serde_json::to_string_pretty(&scan).map_err(|e| e.to_string())?
        );
        return Ok(());
    }
    println!(
        "\nENV REAPER\n\n{} · {} files · {:.2}s\n",
        scan.name, scan.files, scan.duration
    );
    for v in &scan.variables {
        println!(
            "{:<36} {:<9} {:>3} references{}",
            v.name,
            v.status,
            v.references.len(),
            if v.secret { " · secret" } else { "" }
        )
    }
    println!(
        "\n{} variables · Health: {}%\n",
        scan.variables.len(),
        env_reaper_core::health(&scan)
    );
    for warning in scan.warnings {
        println!("Note: {warning}")
    }
    Ok(())
}
