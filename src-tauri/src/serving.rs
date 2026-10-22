//! Whether an agent's dev server is still up (serving.ts): a quick connect to
//! each port on this Mac. Only loopback is ever tried, so this can't be used
//! to reach anywhere else.

use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream};
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_millis(200);

/// Something accepts connections on `port`, over IPv4 or IPv6 (Vite on
/// `localhost` listens on `::1` only).
fn open(port: u16) -> bool {
    [
        SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
        SocketAddr::from((Ipv6Addr::LOCALHOST, port)),
    ]
    .iter()
    .any(|addr| TcpStream::connect_timeout(addr, TIMEOUT).is_ok())
}

/// Which of `ports` are open, in the order given.
#[tauri::command]
pub async fn local_ports_open(ports: Vec<u16>) -> Vec<u16> {
    tauri::async_runtime::spawn_blocking(move || ports.into_iter().filter(|&p| open(p)).collect())
        .await
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn a_listening_port_is_open_and_port_zero_isnt() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(open(port));
        // Not dropping the listener to test a closed port: a child another
        // test spawns meanwhile can inherit it and keep it open (stale.rs).
        assert!(!open(0));
    }
}
