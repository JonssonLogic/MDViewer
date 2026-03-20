use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind, Debouncer};
use std::fs;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

pub struct WatcherState(pub Mutex<Option<Debouncer<notify::RecommendedWatcher>>>);

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
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

    // Drop existing watcher (stops watching previous file)
    *guard = None;

    let app_handle = app.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(300),
        move |result: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
            if let Ok(events) = result {
                let any_change = events
                    .iter()
                    .any(|e| e.kind == DebouncedEventKind::Any);
                if any_change {
                    let _ = app_handle.emit("file-changed", ());
                }
            }
        },
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    debouncer
        .watcher()
        .watch(std::path::Path::new(&path), RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch path: {}", e))?;

    *guard = Some(debouncer);
    Ok(())
}

#[tauri::command]
pub fn stop_watching(watcher_state: State<'_, WatcherState>) -> Result<(), String> {
    let mut guard = watcher_state
        .0
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    *guard = None;
    Ok(())
}
