//! Remote Explorer: the WSL distros, SSH hosts and running containers this machine can
//! reach. Opening one is done by the frontend (a WSL folder as the workspace, or a terminal
//! running `ssh` / `docker exec`); this module only finds them.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WslDistro {
    pub name: String,
    pub default: bool,
    pub running: bool,
    pub version: u8,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SshHost {
    /// The `Host` alias, what `ssh <name>` takes.
    pub name: String,
    pub hostname: Option<String>,
    pub user: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Container {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
}

/// wsl.exe writes UTF-16LE; decode it (or plain UTF-8 from newer builds).
fn decode_wsl_output(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes.iter().skip(1).step_by(2).take(8).all(|b| *b == 0) {
        let units: Vec<u16> = (0..bytes.len() / 2).map(|i| u16::from_le_bytes([bytes[2 * i], bytes[2 * i + 1]])).collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

/// `wsl -l -v`:
/// ```text
///   NAME            STATE           VERSION
/// * Ubuntu          Running         2
///   docker-desktop  Stopped         2
/// ```
fn parse_wsl_list(text: &str) -> Vec<WslDistro> {
    text.lines()
        .map(|l| l.trim_start_matches('\u{feff}'))
        .filter(|l| !l.trim().is_empty() && !l.trim_start().starts_with("NAME"))
        .filter_map(|l| {
            let default = l.trim_start().starts_with('*');
            let mut cols = l.trim_start().trim_start_matches('*').split_whitespace();
            let name = cols.next()?.to_string();
            let state = cols.next().unwrap_or("");
            let version = cols.next().and_then(|v| v.parse().ok()).unwrap_or(2);
            Some(WslDistro { name, default, running: state.eq_ignore_ascii_case("Running"), version })
        })
        .collect()
}

/// `Host` blocks of an OpenSSH config. Wildcard patterns (`Host *`) are not hosts.
fn parse_ssh_config(text: &str) -> Vec<SshHost> {
    let mut hosts: Vec<SshHost> = vec![];
    // Indices into `hosts` that the current block's HostName/User apply to.
    let mut current: Vec<usize> = vec![];
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (key, value) = match line.split_once(|c: char| c.is_whitespace() || c == '=') {
            Some((k, v)) => (k.to_ascii_lowercase(), v.trim().trim_start_matches('=').trim().trim_matches('"').to_string()),
            None => continue,
        };
        match key.as_str() {
            "host" => {
                current.clear();
                for name in value.split_whitespace() {
                    if name.contains(['*', '?', '!']) {
                        continue;
                    }
                    current.push(hosts.len());
                    hosts.push(SshHost { name: name.to_string(), hostname: None, user: None });
                }
            }
            "match" => current.clear(),
            "hostname" => current.iter().for_each(|&i| hosts[i].hostname = Some(value.clone())),
            "user" => current.iter().for_each(|&i| hosts[i].user = Some(value.clone())),
            _ => {}
        }
    }
    hosts
}

/// `docker ps --format "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}"`
fn parse_docker_ps(text: &str) -> Vec<Container> {
    text.lines()
        .filter_map(|l| {
            let mut f = l.split('\t');
            Some(Container {
                id: f.next()?.trim().to_string(),
                name: f.next()?.trim().to_string(),
                image: f.next()?.trim().to_string(),
                status: f.next().unwrap_or("").trim().to_string(),
            })
        })
        .filter(|c| !c.id.is_empty())
        .collect()
}

#[tauri::command]
pub async fn remote_wsl_distros() -> Vec<WslDistro> {
    if !cfg!(windows) {
        return vec![];
    }
    match crate::core::proc::cmd("wsl.exe").args(["-l", "-v"]).output() {
        Ok(out) if out.status.success() => parse_wsl_list(&decode_wsl_output(&out.stdout)),
        _ => vec![],
    }
}

/// The distro user's home, as a Windows path (`\\wsl.localhost\Ubuntu\home\me`).
#[tauri::command]
pub async fn remote_wsl_home(distro: String) -> Result<String, String> {
    let out = crate::core::proc::cmd("wsl.exe")
        .args(["-d", &distro, "-e", "sh", "-c", "printf %s \"$HOME\""])
        .output()
        .map_err(|e| format!("Could not run wsl.exe: {e}"))?;
    let home = decode_wsl_output(&out.stdout).trim().to_string();
    if !out.status.success() || !home.starts_with('/') {
        return Err(format!("Could not find the home folder in {distro}."));
    }
    Ok(crate::core::wsl::to_unc(&distro, &home))
}

#[tauri::command]
pub async fn remote_ssh_hosts() -> Vec<SshHost> {
    let Some(path) = dirs::home_dir().map(|h| h.join(".ssh").join("config")) else { return vec![] };
    std::fs::read_to_string(path).map(|t| parse_ssh_config(&t)).unwrap_or_default()
}

#[tauri::command]
pub async fn remote_containers() -> Result<Vec<Container>, String> {
    let out = crate::core::proc::cmd("docker")
        .args(["ps", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}"])
        .output()
        .map_err(|_| "Docker is not installed (or not on PATH).".to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(if err.to_lowercase().contains("daemon") || err.contains("pipe") {
            "Docker is installed but not running. Start Docker Desktop, then refresh.".into()
        } else {
            format!("docker ps failed: {}", err.trim())
        });
    }
    Ok(parse_docker_ps(&String::from_utf8_lossy(&out.stdout)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_wsl_list_in_utf16_with_default_and_state() {
        let text = "  NAME            STATE           VERSION\r\n* Ubuntu          Running         2\r\n  docker-desktop  Stopped         2\r\n";
        let utf16: Vec<u8> = text.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        let distros = parse_wsl_list(&decode_wsl_output(&utf16));
        assert_eq!(
            distros,
            vec![
                WslDistro { name: "Ubuntu".into(), default: true, running: true, version: 2 },
                WslDistro { name: "docker-desktop".into(), default: false, running: false, version: 2 },
            ]
        );
        assert_eq!(decode_wsl_output(b"plain"), "plain");
    }

    #[test]
    fn reads_ssh_hosts_but_not_patterns() {
        let cfg = "# mine\nHost salamance oracle\n  HostName 10.0.0.5\n  User ubuntu\n\nHost *.internal\n  User x\nHost gh\n  HostName=github.com\nMatch host foo\n  User nope\n";
        assert_eq!(
            parse_ssh_config(cfg),
            vec![
                SshHost { name: "salamance".into(), hostname: Some("10.0.0.5".into()), user: Some("ubuntu".into()) },
                SshHost { name: "oracle".into(), hostname: Some("10.0.0.5".into()), user: Some("ubuntu".into()) },
                SshHost { name: "gh".into(), hostname: Some("github.com".into()), user: None },
            ]
        );
    }

    #[test]
    fn reads_docker_ps() {
        let out = "abc123\tweb\tnginx:1.27\tUp 3 hours\n\ndef456\tdb\tpostgres:16\tUp 2 days (healthy)\n";
        let c = parse_docker_ps(out);
        assert_eq!(c.len(), 2);
        assert_eq!(c[1], Container { id: "def456".into(), name: "db".into(), image: "postgres:16".into(), status: "Up 2 days (healthy)".into() });
    }
}
