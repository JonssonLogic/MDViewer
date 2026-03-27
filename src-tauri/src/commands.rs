use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind, Debouncer};
use std::collections::HashMap;
use std::fs;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

pub struct WatcherState(pub Mutex<HashMap<String, Debouncer<notify::RecommendedWatcher>>>);

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, &content).map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
pub fn watch_file(
    path: String,
    app: AppHandle,
    watcher_state: State<'_, WatcherState>,
) -> Result<(), String> {
    let mut guard = watcher_state
        .0
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    // Drop existing watcher for this path if any
    guard.remove(&path);

    let path_clone = path.clone();
    let app_handle = app.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(300),
        move |result: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
            if let Ok(events) = result {
                let any_change = events
                    .iter()
                    .any(|e| e.kind == DebouncedEventKind::Any);
                if any_change {
                    let _ = app_handle.emit("file-changed", path_clone.as_str());
                }
            }
        },
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    debouncer
        .watcher()
        .watch(std::path::Path::new(&path), RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch path: {}", e))?;

    guard.insert(path, debouncer);
    Ok(())
}

#[tauri::command]
pub fn stop_watching_file(
    path: String,
    watcher_state: State<'_, WatcherState>,
) -> Result<(), String> {
    let mut guard = watcher_state
        .0
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    guard.remove(&path);
    Ok(())
}
