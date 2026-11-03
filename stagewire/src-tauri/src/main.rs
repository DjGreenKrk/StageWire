mod persist;

use std::fs;
use std::path::Path;

#[tauri::command]
fn save_project(path: String, data: Vec<u8>) -> Result<String, String> {
    persist::save_atomic(Path::new(&path), &data, 5, None)
}

/// Zapis bez rotacji kopii (autozapis); nadal atomowy.
#[tauri::command]
fn save_autosave(path: String, data: Vec<u8>) -> Result<String, String> {
    persist::save_atomic(Path::new(&path), &data, 0, None)
}

#[derive(serde::Serialize)]
struct FileRead { bytes: Vec<u8>, mtime_ms: f64 }

#[tauri::command]
fn read_file(path: String) -> Result<Option<FileRead>, String> {
    let p = Path::new(&path);
    if !p.exists() { return Ok(None); }
    let bytes = fs::read(p).map_err(|e| e.to_string())?;
    let mtime_ms = fs::metadata(p).and_then(|m| m.modified()).ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0);
    Ok(Some(FileRead { bytes, mtime_ms }))
}

#[tauri::command]
fn remove_file(path: String) -> Result<(), String> {
    match fs::remove_file(&path) { Ok(_) => Ok(()), Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()), Err(e) => Err(e.to_string()) }
}

/// Projekt do otwarcia przy starcie: argument wiersza poleceń (np. skojarzenie plików) albo STAGEWIRE_PROJECT.
#[tauri::command]
fn startup_project() -> Option<String> {
    std::env::args().skip(1).find(|a| !a.starts_with("--")).or_else(|| std::env::var("STAGEWIRE_PROJECT").ok())
}

/// Konfiguracja samotestu przekazana przez zmienną środowiskową STAGEWIRE_SELFTEST (JSON).
#[tauri::command]
fn selftest_config() -> serde_json::Value {
    std::env::var("STAGEWIRE_SELFTEST").ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(serde_json::json!({}))
}

#[tauri::command]
fn write_result(json: String) -> Result<(), String> {
    let path = std::env::var("STAGEWIRE_RESULT").map_err(|_| "brak STAGEWIRE_RESULT".to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

/// Folder biblioteki urządzeń użytkownika: `<Dokumenty>/StageWire/Biblioteka` (tworzony, jeśli go nie ma).
#[tauri::command]
fn library_dir(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    // zmienna STAGEWIRE_LIBRARY (testy, instalacje przenośne) wskazuje inny folder biblioteki
    if let Ok(custom) = std::env::var("STAGEWIRE_LIBRARY") {
        if !custom.trim().is_empty() {
            fs::create_dir_all(&custom).map_err(|e| format!("Nie można utworzyć folderu biblioteki: {e}"))?;
            return Ok(custom);
        }
    }
    let base = app.path().document_dir().map_err(|e| format!("Brak folderu Dokumenty: {e}"))?;
    let dir = base.join("StageWire").join("Biblioteka");
    fs::create_dir_all(&dir).map_err(|e| format!("Nie można utworzyć folderu biblioteki: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

#[derive(serde::Serialize)]
struct LibFile { path: String, name: String, text: String }

/// Pliki `*.swpack.json` z folderu (bez podfolderów), do 8 MB każdy; posortowane po nazwie. Pliki nieczytelne są pomijane.
#[tauri::command]
fn list_library(dir: String) -> Result<Vec<LibFile>, String> {
    let mut out = Vec::new();
    for e in fs::read_dir(&dir).map_err(|e| format!("Nie można odczytać folderu biblioteki: {e}"))? {
        let Ok(e) = e else { continue };
        let name = e.file_name().to_string_lossy().into_owned();
        if !name.to_lowercase().ends_with(".swpack.json") { continue; }
        let Ok(meta) = e.metadata() else { continue };
        if !meta.is_file() || meta.len() > 8 * 1024 * 1024 { continue; }
        if let Ok(text) = fs::read_to_string(e.path()) { out.push(LibFile { path: e.path().to_string_lossy().into_owned(), name, text }); }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(|s| s.as_str()) == Some("--cli") {
        std::process::exit(persist::cli(&args[2..]));
    }
    // Linux/WebKitGTK: domyślny renderer DMA-BUF dawał ok. 11 fps nawet przy pustej scenie (zmierzone w PoC-3 w WSLg).
    // Wyłączenie go przywraca ok. 59 fps. Użytkownik może nadpisać zmienną środowiskową; wymaga ponownego pomiaru na natywnym Linuksie.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![startup_project, save_project, save_autosave, read_file, remove_file, selftest_config, write_result, exit_app, library_dir, list_library])
        .run(tauri::generate_context!())
        .expect("błąd uruchomienia aplikacji Tauri");
}
