mod activity;
mod cards;
mod codex_log;
mod control;
mod daemon;
mod editor;
mod gh;
mod git;
mod icons;
mod moments;
mod nebula_setup;
mod preview;
mod relocate;
mod router;
mod serving;
mod settings;
mod stale;
mod thread_edits;
mod title;
mod transcript;
mod tray;
mod turns;
mod usage;
mod uselog;

/// Show and focus the main window, e.g. for the quick-capture hotkey.
#[tauri::command]
fn show_main_window(app: tauri::AppHandle) {
    tray::show_main(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // observatory:// links: an agent handing a task to another project.
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            tray::install(app.handle())?;
            control::start(app.handle());
            Ok(())
        })
        .manage(daemon::DaemonState::default())
        .manage(usage::UsageState::default())
        .manage(activity::ActivityState::default())
        .manage(thread_edits::EditsState::default())
        .manage(turns::TurnsState::default())
        .manage(transcript::TranscriptState::default())
        .manage(preview::PreviewScope::default())
        .manage(control::ControlState::default())
        .register_uri_scheme_protocol("preview", preview::serve)
        .invoke_handler(tauri::generate_handler![
            daemon::connect,
            daemon::send,
            daemon::send_input,
            daemon::start_daemon,
            stale::stale_daemon,
            stale::restart_daemon,
            daemon::read_settings,
            daemon::read_presets,
            daemon::debug_log,
            daemon::inspect_folder,
            cards::read_card_sources,
            router::route_list,
            git::git_status,
            git::git_diff,
            git::delete_branch,
            git::local_branches,
            gh::gh_pr,
            gh::gh_pr_create,
            gh::gh_pr_merge,
            usage::usage_report,
            uselog::append_use_log,
            uselog::use_log_path,
            uselog::clear_use_log,
            moments::save_moment,
            moments::annotate_moment,
            moments::moments_dir,
            control::control_reply,
            serving::local_ports_open,
            activity::activity_report,
            activity::stop_process,
            thread_edits::thread_edits,
            turns::thread_turn,
            transcript::thread_transcript,
            settings::write_setting,
            settings::write_project_setting,
            settings::read_desktop_prefs,
            settings::write_desktop_prefs,
            settings::open_worktree,
            nebula_setup::nebula_status,
            nebula_setup::install_nebula,
            relocate::missing_dirs,
            preview::resolve_paths,
            preview::open_preview,
            preview::read_preview_text,
            preview::preview_modified,
            relocate::carry_project_state,
            icons::read_icon,
            icons::project_logo,
            icons::project_images,
            title::suggest_title,
            tray::update_tray,
            editor::list_editors,
            editor::open_in_editor,
            show_main_window,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Clicking the dock icon brings back a window closed to the menu bar.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                tray::show_main(app);
            }
            let _ = (app, event);
        });
}
