//! Zapis atomowy projektu, kopie zapasowe, blokada doradcza i wykrywanie osieroconych plików.
//! Zasady: docs/mvp/ARCHITECTURE.md §5.2. Hak awarii (`crash_at`) służy wyłącznie testom (zabicie procesu w wybranym punkcie).

use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::thread::sleep;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub fn sha256_hex(data: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(data);
    h.finalize().iter().map(|b| format!("{:02x}", b)).collect()
}

fn crash_if(at: Option<&str>, point: &str) {
    if at == Some(point) {
        eprintln!("CRASH-HOOK: {}", point);
        std::process::abort();
    }
}

fn tmp_path(path: &Path) -> PathBuf {
    let name = path.file_name().unwrap().to_string_lossy();
    path.with_file_name(format!("{}.tmp-{}", name, std::process::id()))
}

pub fn backups_dir(path: &Path) -> PathBuf {
    let name = path.file_name().unwrap().to_string_lossy();
    path.with_file_name(format!("{}.backups", name))
}

/// Zamiana pliku z ponowieniami (antywirus/indeksowanie na Windows potrafią chwilowo blokować cel).
fn replace_with_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut last = None;
    for attempt in 0..8 {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last = Some(e);
                sleep(Duration::from_millis(25 * (attempt + 1)));
            }
        }
    }
    Err(last.unwrap())
}

#[cfg(unix)]
fn sync_dir(dir: &Path) {
    if let Ok(d) = File::open(dir) {
        let _ = d.sync_all();
    }
}
#[cfg(not(unix))]
fn sync_dir(_dir: &Path) {}

/// Zapis atomowy: plik tymczasowy w tym samym katalogu → fsync → weryfikacja (ponowny odczyt + SHA-256) →
/// kopia poprzedniej wersji → zamiana (rename/replace) → fsync katalogu (POSIX).
/// Poprzedni plik pozostaje nietknięty aż do zamiany. Zwraca SHA-256 zapisanych danych.
pub fn save_atomic(path: &Path, data: &[u8], keep_backups: usize, crash_at: Option<&str>) -> Result<String, String> {
    let dir = path.parent().ok_or("brak katalogu nadrzędnego")?;
    fs::create_dir_all(dir).map_err(|e| format!("katalog: {e}"))?;
    let expected = sha256_hex(data);
    let tmp = tmp_path(path);

    let mut f = OpenOptions::new().write(true).create(true).truncate(true).open(&tmp).map_err(|e| format!("plik tymczasowy: {e}"))?;
    // zapis w kawałkach, żeby hak awarii mógł przerwać w połowie zapisu dużego pliku
    let half = data.len() / 2;
    f.write_all(&data[..half]).map_err(|e| cleanup(&tmp, e))?;
    crash_if(crash_at, "mid_write");
    f.write_all(&data[half..]).map_err(|e| cleanup(&tmp, e))?;
    f.sync_all().map_err(|e| cleanup(&tmp, e))?;
    drop(f);
    crash_if(crash_at, "after_tmp_write");

    // weryfikacja po zapisie
    let mut back = Vec::with_capacity(data.len());
    File::open(&tmp).and_then(|mut r| r.read_to_end(&mut back)).map_err(|e| cleanup(&tmp, e))?;
    if sha256_hex(&back) != expected {
        let _ = fs::remove_file(&tmp);
        return Err("weryfikacja po zapisie nie powiodła się (suma kontrolna)".into());
    }
    crash_if(crash_at, "after_verify");

    // kopia zapasowa poprzedniej wersji (jako osobny, pełny plik)
    if path.exists() && keep_backups > 0 {
        let bdir = backups_dir(path);
        fs::create_dir_all(&bdir).map_err(|e| format!("kopie: {e}"))?;
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        fs::copy(path, bdir.join(format!("{:013}.bak", stamp))).map_err(|e| format!("kopia: {e}"))?;
        rotate_backups(&bdir, keep_backups);
    }
    crash_if(crash_at, "before_rename");

    replace_with_retry(&tmp, path).map_err(|e| { let _ = fs::remove_file(&tmp); format!("zamiana pliku: {e}") })?;
    crash_if(crash_at, "after_rename");
    sync_dir(dir);
    Ok(expected)
}

fn cleanup(tmp: &Path, e: std::io::Error) -> String {
    let _ = fs::remove_file(tmp);
    format!("zapis: {e}")
}

fn rotate_backups(dir: &Path, keep: usize) {
    let mut files: Vec<_> = fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).collect();
    files.sort();
    while files.len() > keep {
        let _ = fs::remove_file(files.remove(0));
    }
}

#[derive(serde::Serialize, Debug)]
pub struct Orphans {
    pub tmp_files: Vec<String>,
    pub backups: Vec<String>,
    pub lock: Option<String>,
}

/// Odzyskiwanie: osierocone pliki tymczasowe po awarii, dostępne kopie i blokada.
pub fn scan_recovery(path: &Path) -> Orphans {
    let dir = path.parent().unwrap_or(Path::new("."));
    let prefix = format!("{}.tmp-", path.file_name().unwrap().to_string_lossy());
    let tmp_files = fs::read_dir(dir).into_iter().flatten().flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with(&prefix))
        .map(|e| e.path().to_string_lossy().to_string()).collect();
    let mut backups: Vec<String> = fs::read_dir(backups_dir(path)).into_iter().flatten().flatten().map(|e| e.path().to_string_lossy().to_string()).collect();
    backups.sort();
    let lock = fs::read_to_string(lock_path(path)).ok();
    Orphans { tmp_files, backups, lock }
}

fn lock_path(path: &Path) -> PathBuf {
    let name = path.file_name().unwrap().to_string_lossy();
    path.with_file_name(format!("{}.lock", name))
}

/// Blokada doradcza (informacyjna): użytkownik, komputer, PID, czas. Nie uniemożliwia pracy.
/// Zwraca poprzednią blokadę, jeśli istniała.
pub fn acquire_lock(path: &Path) -> Option<String> {
    let lp = lock_path(path);
    let prev = fs::read_to_string(&lp).ok();
    let user = std::env::var("USERNAME").or_else(|_| std::env::var("USER")).unwrap_or_default();
    let host = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_default();
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let _ = fs::write(&lp, format!("{{\"user\":\"{user}\",\"host\":\"{host}\",\"pid\":{},\"time\":{now}}}", std::process::id()));
    prev
}

pub fn release_lock(path: &Path) {
    let _ = fs::remove_file(lock_path(path));
}

/// Polecenia CLI do testów odpornościowych (uruchamiane przez scripts/poc3-persist.mjs).
pub fn cli(args: &[String]) -> i32 {
    let get = |name: &str| args.iter().find_map(|a| a.strip_prefix(&format!("--{name}=")).map(|s| s.to_string()));
    match args.get(0).map(|s| s.as_str()) {
        Some("save") if args.len() >= 3 => {
            let data = match fs::read(&args[2]) { Ok(d) => d, Err(e) => { eprintln!("odczyt danych: {e}"); return 2; } };
            let keep = get("keep").and_then(|s| s.parse().ok()).unwrap_or(5);
            match save_atomic(Path::new(&args[1]), &data, keep, get("crash-at").as_deref()) {
                Ok(h) => { println!("{h}"); 0 }
                Err(e) => { eprintln!("BŁĄD: {e}"); 1 }
            }
        }
        Some("recover") if args.len() >= 2 => {
            println!("{}", serde_json::to_string(&scan_recovery(Path::new(&args[1]))).unwrap());
            0
        }
        Some("lock") if args.len() >= 2 => {
            let prev = acquire_lock(Path::new(&args[1]));
            println!("{}", prev.unwrap_or_default());
            0
        }
        _ => { eprintln!("użycie: --cli save <plik> <dane> [--keep=N] [--crash-at=P] | recover <plik> | lock <plik>"); 64 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("stagewire-test-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn zapis_tworzy_plik_i_nie_zostawia_tmp() {
        let d = dir("a");
        let p = d.join("p.stagewire");
        let h = save_atomic(&p, b"wersja 1", 3, None).unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"wersja 1");
        assert_eq!(h, sha256_hex(b"wersja 1"));
        assert!(scan_recovery(&p).tmp_files.is_empty());
    }

    #[test]
    fn rotacja_kopii_zachowuje_n_ostatnich() {
        let d = dir("b");
        let p = d.join("p.stagewire");
        for i in 0..8 {
            save_atomic(&p, format!("v{i}").as_bytes(), 3, None).unwrap();
            sleep(Duration::from_millis(3)); // różne znaczniki czasu
        }
        let r = scan_recovery(&p);
        assert_eq!(r.backups.len(), 3);
        assert_eq!(fs::read(&p).unwrap(), b"v7");
        // najnowsza kopia = poprzednia wersja
        assert_eq!(fs::read(r.backups.last().unwrap()).unwrap(), b"v6");
    }

    #[test]
    fn blokada_zwraca_poprzednia_i_zwalnia() {
        let d = dir("c");
        let p = d.join("p.stagewire");
        assert!(acquire_lock(&p).is_none());
        assert!(acquire_lock(&p).is_some());
        release_lock(&p);
        assert!(acquire_lock(&p).is_none());
    }

    #[test]
    fn zapis_na_nieistniejacy_katalog_tworzy_go() {
        let d = dir("d");
        let p = d.join("a/b/p.stagewire");
        save_atomic(&p, b"x", 1, None).unwrap();
        assert!(p.exists());
    }
}
