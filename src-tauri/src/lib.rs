mod commands;

use commands::WatcherState;
use std::collections::HashMap;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            use tauri::{Emitter, Manager};
            // args[0] = executable, args[1] = file path (if any)
            if let Some(file) = args.get(1) {
                let path = std::path::PathBuf::from(&cwd).join(file);
                if let Ok(abs) = path.canonicalize() {
                    // Strip Windows UNC extended prefix (\\?\) which breaks asset URLs
                    let clean = abs.to_string_lossy().to_string();
                    let clean = clean.strip_prefix(r"\\?\").unwrap_or(&clean).to_string();
                    let _ = app.emit("open-file", clean);
                }
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(WatcherState(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::write_file,
            commands::watch_file,
            commands::stop_watching_file,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_cli::init())?;

            // Disable WebView2's built-in zoom so it doesn't
            // conflict with our CSS-based content zoom
            #[cfg(target_os = "windows")]
            {
                use tauri::Manager;
                use webview2_com::Microsoft::Web::WebView2::Win32::{
                    ICoreWebView2, ICoreWebView2Settings,
                };
                let webview = app.get_webview_window("main").unwrap();
                webview.with_webview(|wv| unsafe {
                    let controller = wv.controller();
                    if let Ok(core) = controller.CoreWebView2() {
                        let core: ICoreWebView2 = core;
                        if let Ok(settings) = core.Settings() {
                            let settings: ICoreWebView2Settings = settings;
                            let _ = settings.SetIsZoomControlEnabled(false);
                        }
                    }
                })?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
