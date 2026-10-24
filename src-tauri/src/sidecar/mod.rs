//! Sidecar supervisor: spawn, heartbeat, restart policy, ordered shutdown.
//!
//! The PRD (§4.A.4) is specific about the failure behaviour, and each rule below
//! exists because the alternative loses data or leaves two engines running:
//!
//! - **Ordered shutdown.** Rust asks the sidecar to stop over RPC, which runs
//!   `torrentShutdown` (so resume data is written), flushes playtime, and closes
//!   LevelDB. Only after the reply, or the timeout, is the process killed.
//! - **Wait for the old process.** The next spawn happens after the previous
//!   child has been reaped. LevelDB takes an exclusive lock, and two torrent
//!   engines on one resume file corrupt it.
//! - **Heartbeat.** A sidecar that is alive but wedged is worse than a dead one:
//!   it holds the lock and never answers. Missing heartbeats kill it.
//! - **In-flight rejection.** Requests pending when the process dies fail with
//!   `sidecar_restarted` instead of hanging forever.
//! - **Restart budget.** Three restarts in a minute and the supervisor stops and
//!   asks the user, because a crash loop is a bug report, not something to hide
//!   behind an infinite retry.

pub mod config;
pub mod protocol;
mod rpc;

use std::collections::{HashMap, VecDeque};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex, Notify};

use config::SidecarConfig;
use protocol::{HostMessage, SidecarMessage, WireError, PROTOCOL_VERSION};

/// How often the shell pings the sidecar.
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(3);
/// How long the sidecar may stay silent before it is considered wedged.
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(12);
/// Restart budget: at most this many restarts inside `RESTART_WINDOW`.
const RESTART_BUDGET: usize = 3;
const RESTART_WINDOW: Duration = Duration::from_secs(60);
/// A single `invoke` may take this long before the renderer sees a timeout.
/// Torrent metadata resolution is the slowest legitimate call.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
/// Delay before respawning, so a crash loop does not spin the CPU.
const RESPAWN_DELAY: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SidecarStatus {
    Starting,
    Ready,
    Restarting,
    GaveUp,
    Stopped,
}

struct Inner {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    generation: u64,
    ready: bool,
    gave_up: bool,
    shutting_down: bool,
    restarts: VecDeque<std::time::Instant>,
    last_heartbeat: Option<std::time::Instant>,
    pending: HashMap<String, oneshot::Sender<Result<Value, WireError>>>,
    next_request_id: u64,
    status: SidecarStatus,
    last_error: Option<String>,
    /// Signalled when the sidecar answers the shutdown control message.
    shutdown_done: Option<oneshot::Sender<()>>,
}

pub struct Supervisor {
    app: AppHandle,
    config: SidecarConfig,
    inner: Mutex<Inner>,
    /// Wakes the run loop when the user asks for a restart after `GaveUp`.
    wake: Notify,
    last_heartbeat_seq: AtomicU64,
}

impl Supervisor {
    pub fn new(app: AppHandle, config: SidecarConfig) -> Arc<Self> {
        Arc::new(Self {
            app,
            config,
            inner: Mutex::new(Inner {
                child: None,
                stdin: None,
                generation: 0,
                ready: false,
                gave_up: false,
                shutting_down: false,
                restarts: VecDeque::new(),
                last_heartbeat: None,
                pending: HashMap::new(),
                next_request_id: 1,
                status: SidecarStatus::Starting,
                last_error: None,
                shutdown_done: None,
            }),
            wake: Notify::new(),
            last_heartbeat_seq: AtomicU64::new(0),
        })
    }

    /// Starts the supervisor loop. Returns immediately.
    pub fn start(self: &Arc<Self>) {
        let supervisor = Arc::clone(self);

        tauri::async_runtime::spawn(async move {
            supervisor.run_loop().await;
        });

        let heartbeat = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            heartbeat.watchdog_loop().await;
        });
    }

    pub async fn status(&self) -> Value {
        let inner = self.inner.lock().await;

        json!({
            "status": inner.status,
            "ready": inner.ready,
            "generation": inner.generation,
            "pendingRequests": inner.pending.len(),
            "restartsInWindow": inner.restarts.len(),
            "lastError": inner.last_error,
        })
    }

    /// Renderer → sidecar. Fails fast when the sidecar is not usable.
    pub async fn invoke(
        &self,
        channel: &str,
        args: &[Value],
        window_label: Option<&str>,
    ) -> Result<Value, WireError> {
        self.request_channel(channel, args, window_label, true).await
    }

    /// Renderer → sidecar, fire and forget.
    pub async fn send(
        &self,
        channel: &str,
        args: &[Value],
        window_label: Option<&str>,
    ) -> Result<(), WireError> {
        self.request_channel(channel, args, window_label, false)
            .await
            .map(|_| ())
    }

    async fn request_channel(
        &self,
        channel: &str,
        args: &[Value],
        window_label: Option<&str>,
        expects_result: bool,
    ) -> Result<Value, WireError> {
        let (id, receiver) = {
            let mut inner = self.inner.lock().await;

            if inner.gave_up {
                return Err(WireError::new(
                    "sidecar_unavailable",
                    "The background service stopped after repeated failures. Use \"Try again\".",
                ));
            }

            if !inner.ready {
                return Err(WireError::new(
                    "sidecar_starting",
                    "The background service is starting.",
                ));
            }

            let id = inner.next_request_id.to_string();
            inner.next_request_id += 1;

            let (sender, receiver) = oneshot::channel();
            inner.pending.insert(id.clone(), sender);

            let message = if expects_result {
                HostMessage::Invoke {
                    id: &id,
                    channel,
                    args,
                    window_label,
                }
            } else {
                HostMessage::Send {
                    id: &id,
                    channel,
                    args,
                    window_label,
                }
            };

            if let Err(error) = write_message(&mut inner, &message).await {
                inner.pending.remove(&id);
                return Err(error);
            }

            (id, receiver)
        };

        match tokio::time::timeout(REQUEST_TIMEOUT, receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(WireError::new(
                "sidecar_restarted",
                "The background service restarted before the request finished.",
            )),
            Err(_) => {
                self.inner.lock().await.pending.remove(&id);
                Err(WireError::new(
                    "request_timeout",
                    format!("{channel} did not answer within {REQUEST_TIMEOUT:?}"),
                ))
            }
        }
    }

    /// Asks the sidecar to stop cleanly, then makes sure it is gone.
    pub async fn shutdown(&self, timeout_ms: u64) {
        let (done, wait) = {
            let mut inner = self.inner.lock().await;
            inner.shutting_down = true;
            inner.status = SidecarStatus::Stopped;

            let (sender, receiver) = oneshot::channel();
            inner.shutdown_done = Some(sender);

            let message = HostMessage::shutdown(timeout_ms);
            if let Err(error) = write_message(&mut inner, &message).await {
                eprintln!("[supervisor] cannot send shutdown: {}", error.message);
            }

            ((), receiver)
        };

        let _ = done;

        // Give the sidecar its budget, plus a small margin for the last write.
        let budget = Duration::from_millis(timeout_ms) + Duration::from_millis(500);
        let graceful = tokio::time::timeout(budget, wait).await.is_ok();

        if !graceful {
            eprintln!("[supervisor] shutdown timed out; killing the sidecar");
        }

        self.kill_and_reap().await;
    }

    /// User-initiated restart after the supervisor gave up.
    pub async fn restart(&self) -> Result<(), WireError> {
        {
            let mut inner = self.inner.lock().await;
            inner.gave_up = false;
            inner.restarts.clear();
            inner.status = SidecarStatus::Restarting;
            inner.last_error = None;
        }

        self.wake.notify_one();
        Ok(())
    }

    async fn kill_and_reap(&self) {
        let mut child = {
            let mut inner = self.inner.lock().await;
            inner.stdin.take();
            inner.child.take()
        };

        if let Some(child) = child.as_mut() {
            // `start_kill` is non-blocking; `wait` reaps the process so the next
            // spawn cannot race the LevelDB lock.
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
    }

    async fn run_loop(self: Arc<Self>) {
        loop {
            {
                let mut inner = self.inner.lock().await;
                if inner.shutting_down {
                    break;
                }

                if inner.gave_up {
                    drop(inner);
                    self.wake.notified().await;
                    continue;
                }

                inner.status = SidecarStatus::Starting;
            }

            self.emit_status().await;

            match self.spawn_child().await {
                Ok(generation) => {
                    self.wait_for_exit(generation).await;
                }
                Err(error) => {
                    let mut inner = self.inner.lock().await;
                    inner.last_error = Some(error.message.clone());
                }
            }

            let should_restart = {
                let mut inner = self.inner.lock().await;

                inner.ready = false;
                inner.stdin.take();
                inner.child.take();

                reject_pending(&mut inner, "sidecar_restarted");

                if inner.shutting_down {
                    false
                } else {
                    let exhausted =
                        record_restart(&mut inner.restarts, std::time::Instant::now());

                    if exhausted {
                        inner.gave_up = true;
                        inner.status = SidecarStatus::GaveUp;
                    } else {
                        inner.status = SidecarStatus::Restarting;
                    }

                    true
                }
            };

            self.emit_status().await;

            if !should_restart {
                break;
            }

            {
                let inner = self.inner.lock().await;
                if inner.gave_up {
                    continue;
                }
            }

            tokio::time::sleep(RESPAWN_DELAY).await;
        }

        self.emit_status().await;
    }

    async fn spawn_child(self: &Arc<Self>) -> Result<u64, WireError> {
        let mut command = Command::new(&self.config.node);
        command
            .arg(&self.config.script)
            .current_dir(&self.config.working_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        for (key, value) in &self.config.env {
            command.env(key, value);
        }

        #[cfg(windows)]
        {
            // CREATE_NO_WINDOW: the sidecar must not flash a console window.
            // `tokio::process::Command` exposes this inherently on Windows.
            command.creation_flags(0x0800_0000);
        }

        let mut child = command.spawn().map_err(|error| {
            WireError::new(
                "sidecar_spawn_failed",
                format!("cannot start {}: {error}", self.config.node.display()),
            )
        })?;

        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let generation = {
            let mut inner = self.inner.lock().await;
            inner.generation += 1;
            inner.child = Some(child);
            inner.stdin = stdin;
            inner.last_heartbeat = None;
            inner.generation
        };

        if let Some(stdout) = stdout {
            let reader = Arc::clone(self);
            tauri::async_runtime::spawn(async move {
                reader.read_loop(generation, stdout).await;
            });
        }

        if let Some(stderr) = stderr {
            let mut lines = BufReader::new(stderr).lines();
            tauri::async_runtime::spawn(async move {
                while let Ok(Some(line)) = lines.next_line().await {
                    // The sidecar's own diagnostics. Kept on the shell's stderr
                    // so `yarn tauri dev` shows them next to the Rust log.
                    eprintln!("[sidecar] {line}");
                }
            });
        }

        Ok(generation)
    }

    /// Waits until the current child is gone, without holding the lock.
    async fn wait_for_exit(&self, generation: u64) {
        loop {
            tokio::time::sleep(Duration::from_millis(200)).await;

            let mut inner = self.inner.lock().await;

            if inner.generation != generation {
                return;
            }

            let Some(child) = inner.child.as_mut() else {
                return;
            };

            match child.try_wait() {
                Ok(Some(status)) => {
                    if !status.success() {
                        inner.last_error =
                            Some(format!("sidecar exited with {status}"));
                    }
                    inner.child.take();
                    return;
                }
                Ok(None) => continue,
                Err(error) => {
                    inner.last_error = Some(format!("cannot poll the sidecar: {error}"));
                    inner.child.take();
                    return;
                }
            }
        }
    }

    async fn read_loop(self: Arc<Self>, generation: u64, stdout: tokio::process::ChildStdout) {
        let mut lines = BufReader::new(stdout).lines();

        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if line.trim().is_empty() {
                        continue;
                    }

                    match serde_json::from_str::<SidecarMessage>(&line) {
                        Ok(message) => self.handle_message(generation, message).await,
                        Err(error) => {
                            eprintln!("[supervisor] unparseable sidecar line: {error}");
                        }
                    }
                }
                Ok(None) => return,
                Err(error) => {
                    eprintln!("[supervisor] cannot read sidecar stdout: {error}");
                    return;
                }
            }
        }
    }

    async fn handle_message(self: &Arc<Self>, generation: u64, message: SidecarMessage) {
        match message {
            SidecarMessage::Ready {
                protocol_version,
                pid,
                boot_ms,
            } => {
                if protocol_version != PROTOCOL_VERSION {
                    eprintln!(
                        "[supervisor] protocol mismatch: sidecar speaks v{protocol_version}, shell speaks v{PROTOCOL_VERSION}"
                    );
                    self.kill_and_reap().await;
                    return;
                }

                {
                    let mut inner = self.inner.lock().await;
                    if inner.generation != generation {
                        return;
                    }
                    inner.ready = true;
                    inner.status = SidecarStatus::Ready;
                    inner.last_heartbeat = Some(std::time::Instant::now());
                }

                eprintln!("[supervisor] sidecar ready pid={pid} boot={boot_ms}ms");

                self.emit_status().await;
                self.announce_windows().await;
            }

            SidecarMessage::Result { id, result } => {
                let sender = self.inner.lock().await.pending.remove(&id);
                if let Some(sender) = sender {
                    let _ = sender.send(Ok(result));
                }
            }

            SidecarMessage::Error { id, error } => {
                let sender = self.inner.lock().await.pending.remove(&id);
                if let Some(sender) = sender {
                    let _ = sender.send(Err(error));
                }
            }

            SidecarMessage::Event { channel, payload } => {
                if !crate::ipc::is_event_channel_allowed(&channel) {
                    eprintln!("[supervisor] dropped event on non-allowlisted channel: {channel}");
                    return;
                }

                let _ = self.app.emit(
                    "sphinx:ipc-event",
                    json!({ "channel": channel, "payload": payload }),
                );
            }

            SidecarMessage::Rpc { id, method, params } => {
                let result = rpc::handle(&self.app, self, &method, params).await;

                let message = match result {
                    Ok(value) => HostMessage::RpcResult { id: &id, result: value },
                    Err(error) => HostMessage::RpcError { id: &id, error },
                };

                let mut inner = self.inner.lock().await;
                if let Err(error) = write_message(&mut inner, &message).await {
                    eprintln!("[supervisor] cannot answer rpc {method}: {}", error.message);
                }
            }

            SidecarMessage::Heartbeat { seq } => {
                self.last_heartbeat_seq.store(seq, Ordering::Relaxed);
                self.inner.lock().await.last_heartbeat = Some(std::time::Instant::now());
            }

            SidecarMessage::ShutdownComplete { reason, failures } => {
                if !failures.is_empty() {
                    eprintln!(
                        "[supervisor] sidecar shutdown finished with failures: {}",
                        failures.join("; ")
                    );
                }
                eprintln!("[supervisor] sidecar shutdown complete ({reason})");

                if let Some(sender) = self.inner.lock().await.shutdown_done.take() {
                    let _ = sender.send(());
                }
            }
        }
    }

    /// Tells the sidecar which windows already exist, so `webContents.send`
    /// reaches them. Without this the sidecar's `WindowManager` has no window
    /// and every event is silently dropped.
    async fn announce_windows(self: &Arc<Self>) {
        let windows: Vec<(String, String)> = self
            .app
            .webview_windows()
            .into_iter()
            .map(|(label, window)| {
                let url = window.url().map(|url| url.to_string()).unwrap_or_default();
                (label, url)
            })
            .collect();

        let mut inner = self.inner.lock().await;

        for (label, url) in windows {
            let message = HostMessage::window_attached(&label, 0, &url);
            if let Err(error) = write_message(&mut inner, &message).await {
                eprintln!("[supervisor] cannot announce window {label}: {}", error.message);
            }
        }
    }

    pub async fn announce_window(&self, label: &str, url: &str) {
        let mut inner = self.inner.lock().await;
        let message = HostMessage::window_attached(label, 0, url);
        if let Err(error) = write_message(&mut inner, &message).await {
            eprintln!("[supervisor] cannot announce window {label}: {}", error.message);
        }
    }

    /// Forwards update download progress (bytes received, total when known).
    pub async fn announce_update_progress(&self, downloaded: u64, total: Option<u64>) {
        let mut inner = self.inner.lock().await;
        let message = HostMessage::update_progress(downloaded, total);
        if let Err(error) = write_message(&mut inner, &message).await {
            eprintln!("[supervisor] cannot forward update progress: {}", error.message);
        }
    }

    /// Forwards a tray menu click to the sidecar.
    ///
    /// The `click` closures live in `createSystemTray` (sidecar side); Rust only
    /// owns the native menu, so it reports which id was chosen and nothing else.
    pub async fn announce_tray_click(&self, item_id: &str) {
        let mut inner = self.inner.lock().await;
        let message = HostMessage::tray_click(item_id);
        if let Err(error) = write_message(&mut inner, &message).await {
            eprintln!("[supervisor] cannot forward tray click: {}", error.message);
        }
    }

    /// Forwards a tray icon mouse event (`click`, `double-click`, `right-click`).
    pub async fn announce_tray_event(&self, kind: &str) {
        let mut inner = self.inner.lock().await;
        let message = HostMessage::tray_event(kind);
        if let Err(error) = write_message(&mut inner, &message).await {
            eprintln!("[supervisor] cannot forward tray event: {}", error.message);
        }
    }

    /// Forwards a `sphinx://` URL (first launch or while running).
    pub async fn announce_deep_link(&self, url: &str) {
        let mut inner = self.inner.lock().await;
        let message = HostMessage::deep_link(url);
        if let Err(error) = write_message(&mut inner, &message).await {
            eprintln!("[supervisor] cannot forward deep link: {}", error.message);
        }
    }

    /// Forwards a second-instance launch: focus the first window and, when argv
    /// carried a deep link, run it.
    pub async fn announce_second_instance(&self, url: Option<&str>, force_big_picture: bool) {
        let mut inner = self.inner.lock().await;
        let message = HostMessage::second_instance(url, force_big_picture);
        if let Err(error) = write_message(&mut inner, &message).await {
            eprintln!("[supervisor] cannot forward second instance: {}", error.message);
        }
    }

    /// Tells the sidecar the window painted its first frame (`ready-to-show`).
    pub async fn announce_window_ready(&self, label: &str) {
        let mut inner = self.inner.lock().await;
        let message = HostMessage::window_ready(label);
        if let Err(error) = write_message(&mut inner, &message).await {
            eprintln!("[supervisor] cannot mark window {label} ready: {}", error.message);
        }
    }

    pub async fn announce_window_closed(&self, label: &str) {
        let mut inner = self.inner.lock().await;
        let message = HostMessage::window_detached(label);
        if let Err(error) = write_message(&mut inner, &message).await {
            eprintln!("[supervisor] cannot detach window {label}: {}", error.message);
        }
    }

    async fn watchdog_loop(self: Arc<Self>) {
        let mut ticker = tokio::time::interval(HEARTBEAT_INTERVAL);

        loop {
            ticker.tick().await;

            let (ready, seq, stalled) = {
                let inner = self.inner.lock().await;
                let stalled =
                    inner.ready && is_stalled(inner.last_heartbeat, std::time::Instant::now());
                (inner.ready, self.last_heartbeat_seq.load(Ordering::Relaxed), stalled)
            };

            if !ready {
                continue;
            }

            if stalled {
                eprintln!(
                    "[supervisor] sidecar missed heartbeats for {HEARTBEAT_TIMEOUT:?}; killing it"
                );
                self.kill_and_reap().await;
                continue;
            }

            let message = HostMessage::ping(seq + 1);
            let mut inner = self.inner.lock().await;
            if let Err(error) = write_message(&mut inner, &message).await {
                eprintln!("[supervisor] cannot ping the sidecar: {}", error.message);
            }
        }
    }

    async fn emit_status(&self) {
        let status = self.status().await;
        let _ = self.app.emit("sphinx:sidecar-status", status);
    }
}

/// Records a restart and reports whether the budget is now exhausted.
///
/// Restarts older than `RESTART_WINDOW` are dropped first, so the budget is
/// "three restarts inside a minute", not "three restarts ever".
fn record_restart(restarts: &mut VecDeque<std::time::Instant>, now: std::time::Instant) -> bool {
    while restarts
        .front()
        .is_some_and(|at| now.duration_since(*at) > RESTART_WINDOW)
    {
        restarts.pop_front();
    }

    restarts.push_back(now);

    restarts.len() >= RESTART_BUDGET
}

/// True when the sidecar has been silent for longer than the heartbeat budget.
fn is_stalled(last: Option<std::time::Instant>, now: std::time::Instant) -> bool {
    last.is_some_and(|at| now.duration_since(at) > HEARTBEAT_TIMEOUT)
}

async fn write_message(inner: &mut Inner, message: &HostMessage<'_>) -> Result<(), WireError> {
    let Some(stdin) = inner.stdin.as_mut() else {
        return Err(WireError::new(
            "sidecar_unavailable",
            "The background service is not running.",
        ));
    };

    let mut line = serde_json::to_string(message).map_err(|error| {
        WireError::new("invalid_message", format!("cannot serialise: {error}"))
    })?;
    line.push('\n');

    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|error| WireError::new("sidecar_unavailable", format!("write failed: {error}")))?;

    stdin.flush().await.map_err(|error| {
        WireError::new("sidecar_unavailable", format!("flush failed: {error}"))
    })
}

fn reject_pending(inner: &mut Inner, code: &str) {
    for (_, sender) in inner.pending.drain() {
        let _ = sender.send(Err(WireError::new(
            code,
            "The background service restarted before the request finished.",
        )));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn three_restarts_inside_the_window_exhaust_the_budget() {
        let start = Instant::now();
        let mut restarts = VecDeque::new();

        assert!(!record_restart(&mut restarts, start));
        assert!(!record_restart(&mut restarts, start + Duration::from_secs(1)));
        assert!(record_restart(&mut restarts, start + Duration::from_secs(2)));
    }

    #[test]
    fn restarts_outside_the_window_do_not_count() {
        let start = Instant::now();
        let mut restarts = VecDeque::new();

        assert!(!record_restart(&mut restarts, start));
        assert!(!record_restart(&mut restarts, start + Duration::from_secs(10)));
        assert!(!record_restart(&mut restarts, start + Duration::from_secs(20)));
        // The first three have aged out, so this one is the first in a new window.
        assert!(!record_restart(
            &mut restarts,
            start + RESTART_WINDOW + Duration::from_secs(1)
        ));
        assert_eq!(restarts.len(), 1);
    }

    #[test]
    fn a_missing_heartbeat_never_looks_stalled() {
        let now = Instant::now();
        assert!(!is_stalled(None, now));
    }

    #[test]
    fn silence_past_the_timeout_is_stalled() {
        let now = Instant::now();
        assert!(!is_stalled(Some(now), now));
        assert!(!is_stalled(
            Some(now - HEARTBEAT_TIMEOUT),
            now
        ));
        assert!(is_stalled(
            Some(now - HEARTBEAT_TIMEOUT - Duration::from_millis(1)),
            now
        ));
    }
}
