//! `power.*` RPC methods.
//!
//! Keeps the display awake while a download runs or a compatibility layer
//! launches (`src/main/services/power-save-blocker.ts`). The sidecar sends
//! `power.setSleepBlocked { blocked: true }` / `{ blocked: false }` via RPC;
//! the shell holds a `keepawake::KeepAwake` guard while blocked.
//!
//! The guard is owned by one dedicated thread, not by a `Mutex` in a static.
//! `keepawake` implements the inhibitor on Windows with
//! `SetThreadExecutionState`, which is **per-thread**: the state belongs to the
//! thread that created the guard, and `Drop` clears the state of whichever
//! thread drops it. RPC handlers run on arbitrary Tokio worker threads, so a
//! guard created on thread A and dropped on thread B would leave A's
//! `ES_CONTINUOUS` request in place until A exits — i.e. the machine would
//! never sleep again. A channel keeps `create`, the guard's lifetime and `Drop`
//! on the same thread.

use std::sync::mpsc;
use std::sync::OnceLock;

use serde_json::{json, Value};

use crate::sidecar::protocol::WireError;

/// Commands for the thread that owns the wake lock.
enum Command {
    Set {
        blocked: bool,
        reply: mpsc::Sender<Result<(), String>>,
    },
}

/// The wake-lock thread's inbox, created on first use.
static COMMANDS: OnceLock<mpsc::Sender<Command>> = OnceLock::new();

/// Creates the guard, or drops it, on the calling thread.
fn apply(guard: &mut Option<keepawake::KeepAwake>, blocked: bool) -> Result<(), String> {
    if !blocked {
        // Dropping the guard restores the previous power state.
        *guard = None;
        return Ok(());
    }

    if guard.is_some() {
        return Ok(());
    }

    let created = keepawake::Builder::default()
        .display(true)
        .idle(true)
        .reason("Sphinx Launcher download or game session")
        .app_name("Sphinx Launcher")
        .app_reverse_domain("io.github.rakamahendra.sphinx")
        .create()
        .map_err(|error| {
            eprintln!("[power] failed to inhibit sleep: {error}");
            error.to_string()
        })?;

    *guard = Some(created);
    Ok(())
}

/// The thread body: it owns the guard for the whole program lifetime.
fn worker(receiver: mpsc::Receiver<Command>) {
    let mut guard: Option<keepawake::KeepAwake> = None;

    while let Ok(Command::Set { blocked, reply }) = receiver.recv() {
        let outcome = apply(&mut guard, blocked);
        if reply.send(outcome).is_err() {
            eprintln!("[power] caller went away before the reply");
        }
    }
}

fn commands() -> &'static mpsc::Sender<Command> {
    COMMANDS.get_or_init(|| {
        let (sender, receiver) = mpsc::channel::<Command>();
        if let Err(error) = std::thread::Builder::new()
            .name("sphinx-power".to_string())
            .spawn(move || worker(receiver))
        {
            // The receiver is dropped with the failed closure, so every later
            // `send` fails and `set_sleep_blocked` reports unsupported.
            eprintln!("[power] cannot start the wake-lock thread: {error}");
        }
        sender
    })
}

pub fn set_sleep_blocked(params: &Value) -> Result<Value, WireError> {
    let blocked = params
        .get("blocked")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let (reply, reply_rx) = mpsc::channel::<Result<(), String>>();

    if let Err(error) = commands().send(Command::Set { blocked, reply }) {
        return Ok(json!({
            "blocked": false,
            "supported": false,
            "error": format!("wake-lock thread unavailable: {error}"),
        }));
    }

    match reply_rx.recv() {
        Ok(Ok(())) => Ok(json!({ "blocked": blocked, "supported": true })),
        Ok(Err(error)) => Ok(json!({
            "blocked": false,
            "supported": false,
            "error": error,
        })),
        Err(error) => Ok(json!({
            "blocked": false,
            "supported": false,
            "error": format!("wake-lock thread did not reply: {error}"),
        })),
    }
}
