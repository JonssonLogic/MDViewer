mod commands;

use commands::WatcherState;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(WatcherState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::watch_file,
            commands::stop_watching,
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
