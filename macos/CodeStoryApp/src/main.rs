use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    tray::TrayIconBuilder,
    AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

const APP_URL: &str = "http://127.0.0.1:7787";
const PROJECT_PATH: &str = env!("CODESTORY_PROJECT_PATH");

#[derive(Default)]
struct ServerState {
    child: Mutex<Option<Child>>,
}

struct ZoomState(Mutex<f64>);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default)]
struct Preferences {
    zoom: f64,
    // The restore size the window returns to when it is un-maximized. codeStory
    // always opens maximized, so this is never the size we launch at.
    window_width: f64,
    window_height: f64,
    last_path: String,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            zoom: 1.0,
            window_width: 1380.0,
            window_height: 880.0,
            last_path: "/".into(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PortState {
    Available,
    CodeStory,
    Occupied,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum StartupProbeAction {
    Ready,
    Wait,
}

fn home_directory() -> PathBuf {
    dirs::home_dir().unwrap_or_else(std::env::temp_dir)
}

fn support_directory() -> PathBuf {
    home_directory().join("Library/Application Support/codeStory")
}

fn preferences_path() -> PathBuf {
    support_directory().join("preferences.json")
}

fn clamped_window_size(
    saved_width: f64,
    saved_height: f64,
    work_area_width: f64,
    work_area_height: f64,
) -> (f64, f64) {
    // A display change or old zoomed session can leave impossible logical
    // dimensions in preferences. Let the window occupy most of the current
    // work area without asking macOS to squeeze a 4K WebView onto a laptop.
    let max_width = (work_area_width * 0.94).min(1600.0).max(920.0);
    let max_height = (work_area_height * 0.92).min(1000.0).max(620.0);
    (
        saved_width.clamp(920.0, max_width),
        saved_height.clamp(620.0, max_height),
    )
}

fn log_path() -> PathBuf {
    home_directory().join("Library/Logs/codeStory.log")
}

fn diagnostic_log(message: &str) {
    if let Some(parent) = log_path().parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut log) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path())
    {
        let _ = writeln!(log, "[desktop] {message}");
    }
}

fn load_preferences() -> Preferences {
    fs::read_to_string(preferences_path())
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or_default()
}

fn save_preferences(app: &AppHandle) {
    let mut preferences = load_preferences();
    preferences.zoom = app
        .state::<ZoomState>()
        .0
        .lock()
        .map(|zoom| *zoom)
        .unwrap_or(1.0)
        .clamp(0.5, 3.0);

    if let Some(window) = app.get_webview_window("main") {
        // A maximized window's size is the screen's, not a size worth restoring
        // to. Only record the size the user actually chose.
        if !window.is_maximized().unwrap_or(false) {
            if let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) {
                preferences.window_width = (size.width as f64 / scale).clamp(920.0, 3840.0);
                preferences.window_height = (size.height as f64 / scale).clamp(620.0, 2160.0);
            }
        }
        if let Ok(url) = window.url() {
            if url.host_str() == Some("127.0.0.1") && !url.path().starts_with("/api/") {
                let mut route = url.path().to_string();
                if let Some(query) = url.query() {
                    route.push('?');
                    route.push_str(query);
                }
                if let Some(fragment) = url.fragment() {
                    route.push('#');
                    route.push_str(fragment);
                }
                preferences.last_path = route;
            }
        }
    }

    if let Some(parent) = preferences_path().parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(&preferences) {
        if let Err(error) = fs::write(preferences_path(), json) {
            diagnostic_log(&format!("failed to save preferences: {error}"));
        }
    }
}

fn probe_port() -> PortState {
    let address: SocketAddr = match "127.0.0.1:7787".parse() {
        Ok(address) => address,
        Err(_) => return PortState::Available,
    };
    probe_address(address)
}

fn probe_address(address: SocketAddr) -> PortState {
    let mut stream = match TcpStream::connect_timeout(&address, Duration::from_millis(250)) {
        Ok(stream) => stream,
        Err(_) => return PortState::Available,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(700)));
    if stream
        .write_all(b"GET /api/health HTTP/1.0\r\nHost: 127.0.0.1:7787\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return PortState::Occupied;
    }
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    if response.contains("\"app\":\"codeStory\"") && response.contains("\"ready\":true") {
        PortState::CodeStory
    } else {
        PortState::Occupied
    }
}

fn confirmed_port_state_with<F, P>(mut probe: F, mut pause: P) -> PortState
where
    F: FnMut() -> PortState,
    P: FnMut(),
{
    let first = probe();
    if first != PortState::CodeStory {
        return first;
    }
    pause();
    probe()
}

fn confirmed_port_state() -> PortState {
    confirmed_port_state_with(probe_port, || thread::sleep(Duration::from_millis(250)))
}

fn startup_probe_action(state: PortState) -> StartupProbeAction {
    match state {
        PortState::CodeStory => StartupProbeAction::Ready,
        PortState::Available | PortState::Occupied => StartupProbeAction::Wait,
    }
}

fn node_path() -> Option<PathBuf> {
    ["/usr/local/bin/node", "/opt/homebrew/bin/node"]
        .into_iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
}

fn spawn_server() -> std::io::Result<Child> {
    let node = node_path().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "Node.js is not installed")
    })?;
    let server_entry = PathBuf::from(PROJECT_PATH).join("dist/app-server.js");
    if !server_entry.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "codeStory has not been built",
        ));
    }
    if let Some(parent) = log_path().parent() {
        fs::create_dir_all(parent)?;
    }
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path())?;
    let error_log = log.try_clone()?;
    let path = format!(
        "{}/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        home_directory().display()
    );

    Command::new(node)
        .arg(server_entry)
        .args(["--no-open", "--port", "7787"])
        .current_dir(PROJECT_PATH)
        .env("PATH", path)
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(error_log))
        .spawn()
}

fn loading_eval(app: &AppHandle, function: &str, title: &str, detail: &str) {
    let title = serde_json::to_string(title).unwrap_or_else(|_| "\"codeStory\"".into());
    let detail = serde_json::to_string(detail).unwrap_or_else(|_| "\"\"".into());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval(format!(
            "window.{function} && window.{function}({title}, {detail})"
        ));
    }
}

fn show_status(app: &AppHandle, title: &str, detail: &str) {
    loading_eval(app, "setStatus", title, detail);
}

fn show_startup_error(app: &AppHandle, title: &str, detail: &str) {
    loading_eval(app, "showStartupError", title, detail);
}

fn workspace_url() -> tauri::Url {
    let path = load_preferences().last_path;
    let route = if path.starts_with('/') {
        path
    } else {
        "/".into()
    };
    format!("{APP_URL}{route}")
        .parse()
        .unwrap_or_else(|_| APP_URL.parse().unwrap())
}

fn navigate_to_workspace(app: &AppHandle) {
    show_status(app, "Loading reviews", "Restoring where you left off…");
    thread::sleep(Duration::from_millis(120));
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.navigate(workspace_url());
    }
}

fn server_exited(app: &AppHandle) -> bool {
    app.state::<ServerState>()
        .child
        .lock()
        .map(|mut child| {
            child
                .as_mut()
                .and_then(|process| process.try_wait().ok().flatten())
                .is_some()
        })
        .unwrap_or(true)
}

fn start_or_connect(app: AppHandle) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(80));
        match confirmed_port_state() {
            PortState::CodeStory => {
                diagnostic_log("connected to an existing codeStory server");
                navigate_to_workspace(&app);
                return;
            }
            PortState::Occupied => {
                show_startup_error(
                    &app,
                    "Port 7787 is already in use",
                    "Close the other local app using port 7787, then try again. codeStory did not stop it automatically.",
                );
                return;
            }
            PortState::Available => {}
        }

        show_status(
            &app,
            "Starting codeStory",
            "Launching the local review workspace…",
        );
        let state = app.state::<ServerState>();
        let should_spawn = state
            .child
            .lock()
            .map(|mut child| match child.as_mut() {
                Some(process) => process.try_wait().ok().flatten().is_some(),
                None => true,
            })
            .unwrap_or(false);

        if should_spawn {
            match spawn_server() {
                Ok(process) => {
                    diagnostic_log(&format!("started codeStory server pid {}", process.id()));
                    if let Ok(mut child) = state.child.lock() {
                        *child = Some(process);
                    }
                }
                Err(error) => {
                    diagnostic_log(&format!("server spawn failed: {error}"));
                    show_startup_error(
                        &app,
                        "codeStory needs attention",
                        "The local build is missing or outdated. Run the codeStory macOS installer again.",
                    );
                    return;
                }
            }
        }

        for attempt in 0..100 {
            match startup_probe_action(probe_port()) {
                StartupProbeAction::Ready => {
                    diagnostic_log("codeStory server is ready");
                    navigate_to_workspace(&app);
                    return;
                }
                StartupProbeAction::Wait => {}
            }
            if server_exited(&app) {
                show_startup_error(
                    &app,
                    "codeStory stopped during startup",
                    "Open the log to see the server error, or reinstall the local app to refresh its build.",
                );
                return;
            }
            if attempt == 20 {
                show_status(
                    &app,
                    "Still starting codeStory",
                    "The first launch can take a little longer after an update…",
                );
            }
            thread::sleep(Duration::from_millis(100));
        }

        show_startup_error(
            &app,
            "codeStory took too long to start",
            "Try again once. If it still fails, open the startup log for details.",
        );
    });
}

fn stop_server(app: &AppHandle) {
    if let Ok(mut child) = app.state::<ServerState>().child.lock() {
        if let Some(mut process) = child.take() {
            let _ = Command::new("/bin/kill")
                .args(["-TERM", &process.id().to_string()])
                .status();
            let _ = process.wait();
        }
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn open_in_browser(app: &AppHandle) {
    let url = app
        .get_webview_window("main")
        .and_then(|window| window.url().ok())
        .filter(|url| url.host_str() == Some("127.0.0.1"))
        .map(|url| url.to_string())
        .unwrap_or_else(|| APP_URL.into());
    let _ = Command::new("/usr/bin/open").arg(url).spawn();
}

fn reveal_log() {
    let _ = Command::new("/usr/bin/open")
        .args(["-R", &log_path().to_string_lossy()])
        .spawn();
}

fn reload_or_retry(app: &AppHandle) {
    show_main_window(app);
    if let Some(window) = app.get_webview_window("main") {
        let loaded = window
            .url()
            .map(|url| url.host_str() == Some("127.0.0.1"))
            .unwrap_or(false);
        if loaded {
            let _ = window.reload();
        } else {
            show_status(
                app,
                "Trying codeStory again",
                "Checking the local workspace and its port…",
            );
            start_or_connect(app.clone());
        }
    }
}

fn apply_zoom(app: &AppHandle, delta: Option<f64>) {
    if let Ok(mut zoom) = app.state::<ZoomState>().0.lock() {
        *zoom = match delta {
            Some(delta) => (*zoom + delta).clamp(0.5, 3.0),
            None => 1.0,
        };
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_zoom(*zoom);
        }
    }
}

#[tauri::command]
fn retry_startup(app: AppHandle) {
    show_status(
        &app,
        "Trying codeStory again",
        "Checking the local workspace and its port…",
    );
    start_or_connect(app);
}

#[tauri::command]
fn show_log() {
    reveal_log();
}

fn main() {
    let preferences = load_preferences();
    let initial_zoom = preferences.zoom.clamp(0.5, 3.0);
    let initial_window = preferences.clone();

    let app = tauri::Builder::default()
        .manage(ServerState::default())
        .manage(ZoomState(Mutex::new(initial_zoom)))
        .invoke_handler(tauri::generate_handler![retry_startup, show_log])
        .setup(move |app| {
            diagnostic_log("Tauri setup started");
            let app_menu = SubmenuBuilder::new(app, "codeStory")
                .about(None)
                .separator()
                .quit()
                .build()?;
            let open_browser = MenuItemBuilder::with_id("open_browser", "Open in Browser")
                .accelerator("CmdOrCtrl+Shift+O")
                .build(app)?;
            let show_log = MenuItemBuilder::with_id("show_log", "Show Startup Log").build(app)?;
            let export_video = MenuItemBuilder::with_id("export_video", "Export Video…")
                .accelerator("CmdOrCtrl+Shift+E")
                .build(app)?;
            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&export_video)
                .separator()
                .item(&open_browser)
                .separator()
                .close_window()
                .build()?;
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let back = MenuItemBuilder::with_id("back", "Back")
                .accelerator("CmdOrCtrl+[")
                .build(app)?;
            let forward = MenuItemBuilder::with_id("forward", "Forward")
                .accelerator("CmdOrCtrl+]")
                .build(app)?;
            let reload = MenuItemBuilder::with_id("reload", "Reload codeStory")
                .accelerator("CmdOrCtrl+R")
                .build(app)?;
            let navigate_menu = SubmenuBuilder::new(app, "Navigate")
                .item(&back)
                .item(&forward)
                .separator()
                .item(&reload)
                .build()?;
            let zoom_in = MenuItemBuilder::with_id("zoom_in", "Zoom In")
                .accelerator("CmdOrCtrl+=")
                .build(app)?;
            let zoom_out = MenuItemBuilder::with_id("zoom_out", "Zoom Out")
                .accelerator("CmdOrCtrl+-")
                .build(app)?;
            let zoom_reset = MenuItemBuilder::with_id("zoom_reset", "Actual Size")
                .accelerator("CmdOrCtrl+0")
                .build(app)?;
            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&zoom_in)
                .item(&zoom_out)
                .item(&zoom_reset)
                .build()?;
            let help_menu = SubmenuBuilder::new(app, "Help").item(&show_log).build()?;
            let menu = MenuBuilder::new(app)
                .items(&[
                    &app_menu,
                    &file_menu,
                    &edit_menu,
                    &navigate_menu,
                    &view_menu,
                    &help_menu,
                ])
                .build()?;
            app.set_menu(menu)?;

            let tray_menu = MenuBuilder::new(app)
                .text("show", "Show codeStory")
                .text("open_browser", "Open in Browser")
                .text("reload", "Reload")
                .separator()
                .text("show_log", "Show Startup Log")
                .separator()
                .text("quit", "Quit codeStory")
                .build()?;
            TrayIconBuilder::with_id("codestory-tray")
                .title("CS")
                .tooltip("codeStory · local code review")
                .menu(&tray_menu)
                .build(app)?;

            let (window_width, window_height) = app
                .primary_monitor()
                .ok()
                .flatten()
                .map(|monitor| {
                    let scale = monitor.scale_factor().max(1.0);
                    let work_area = monitor.work_area();
                    clamped_window_size(
                        initial_window.window_width,
                        initial_window.window_height,
                        work_area.size.width as f64 / scale,
                        work_area.size.height as f64 / scale,
                    )
                })
                .unwrap_or((
                    initial_window.window_width,
                    initial_window.window_height,
                ));
            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("codeStory")
                    .inner_size(window_width, window_height)
                    .min_inner_size(920.0, 620.0)
                    // Review wants every pixel it can get, so codeStory always
                    // opens filling the screen. `inner_size` above stays the
                    // size the window returns to once the user un-maximizes it.
                    .maximized(true)
                    .build()?;
            let _ = window.set_zoom(initial_zoom);
            start_or_connect(app.handle().clone());
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "open_browser" => open_in_browser(app),
            "export_video" => {
                show_main_window(app);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.eval("if (document.querySelector('[data-video-export-dialog]')) { document.dispatchEvent(new Event('codestory:export-video')); } else { window.alert('Open a guided story before exporting a video.'); }");
                }
            }
            "show_log" => reveal_log(),
            "back" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.eval("history.back()");
                }
            }
            "forward" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.eval("history.forward()");
                }
            }
            "reload" => reload_or_retry(app),
            "zoom_in" => apply_zoom(app, Some(0.1)),
            "zoom_out" => apply_zoom(app, Some(-0.1)),
            "zoom_reset" => apply_zoom(app, None),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::CloseRequested { .. }) {
                save_preferences(window.app_handle());
                window.app_handle().exit(0);
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build codeStory");

    app.run(|app, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            save_preferences(app);
            stop_server(app);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::net::TcpListener;

    #[test]
    fn a_server_that_disappears_during_confirmation_is_not_reused() {
        let mut states = VecDeque::from([PortState::CodeStory, PortState::Available]);
        let state =
            confirmed_port_state_with(|| states.pop_front().expect("probe called twice"), || {});
        assert_eq!(state, PortState::Available);
    }

    #[test]
    fn a_stable_codestory_server_is_reused() {
        let mut states = VecDeque::from([PortState::CodeStory, PortState::CodeStory]);
        let state =
            confirmed_port_state_with(|| states.pop_front().expect("probe called twice"), || {});
        assert_eq!(state, PortState::CodeStory);
    }

    #[test]
    fn an_available_port_does_not_wait_for_confirmation() {
        let mut paused = false;
        let state = confirmed_port_state_with(|| PortState::Available, || paused = true);
        assert_eq!(state, PortState::Available);
        assert!(!paused);
    }

    #[test]
    fn a_half_started_owned_server_keeps_the_readiness_loop_waiting() {
        assert_eq!(
            startup_probe_action(PortState::Occupied),
            StartupProbeAction::Wait
        );
    }

    #[test]
    fn a_valid_keep_alive_response_is_recognized_without_waiting_for_eof() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let address = listener.local_addr().expect("test server address");
        let responder = thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("accept probe");
            let mut request = [0_u8; 512];
            let _ = socket.read(&mut request);
            socket
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 32\r\nConnection: keep-alive\r\n\r\n{\"app\":\"codeStory\",\"ready\":true}",
                )
                .expect("write probe response");
            thread::sleep(Duration::from_millis(900));
        });

        assert_eq!(probe_address(address), PortState::CodeStory);
        responder.join().expect("join test server");
    }

    #[test]
    fn restored_window_size_is_clamped_to_the_current_work_area() {
        assert_eq!(
            clamped_window_size(3832.0, 2114.0, 1512.0, 944.0),
            (1421.28, 868.48),
        );
    }

    #[test]
    fn ordinary_saved_window_size_is_preserved() {
        assert_eq!(
            clamped_window_size(1280.0, 760.0, 1512.0, 944.0),
            (1280.0, 760.0),
        );
    }

    #[test]
    fn a_native_4k_work_area_does_not_create_a_wall_sized_review_window() {
        assert_eq!(
            clamped_window_size(3832.0, 2114.0, 3840.0, 2160.0),
            (1600.0, 1000.0),
        );
    }
}
