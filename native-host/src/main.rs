use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};
use std::process::{Command, Stdio};
use url::Url;

const MAX_MESSAGE_BYTES: usize = 64 * 1024;
const MAX_URL_BYTES: usize = 8192;

#[derive(Debug, Deserialize)]
struct Request {
    url: String,
}

#[derive(Debug, Serialize)]
struct Response {
    ok: bool,
    error: Option<String>,
}

fn read_message<R: Read>(input: &mut R) -> io::Result<Option<Vec<u8>>> {
    let mut len_bytes = [0_u8; 4];
    match input.read_exact(&mut len_bytes) {
        Ok(()) => {
            let len = u32::from_le_bytes(len_bytes) as usize;
            if len > MAX_MESSAGE_BYTES {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Message too large",
                ));
            }
            let mut buf = vec![0_u8; len];
            input.read_exact(&mut buf)?;
            Ok(Some(buf))
        }
        Err(err) if err.kind() == io::ErrorKind::UnexpectedEof => Ok(None),
        Err(err) => Err(err),
    }
}

fn write_message<W: Write>(output: &mut W, response: &Response) -> io::Result<()> {
    let payload = serde_json::to_vec(response).map_err(io::Error::other)?;
    let len = (payload.len() as u32).to_le_bytes();
    output.write_all(&len)?;
    output.write_all(&payload)?;
    output.flush()?;
    Ok(())
}

fn validate_url(raw: &str) -> Result<Url, String> {
    if raw.len() > MAX_URL_BYTES {
        return Err("URL too long".into());
    }
    let url = Url::parse(raw).map_err(|e| format!("Invalid URL: {e}"))?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("URL credentials are not allowed".into());
    }
    match url.scheme() {
        "http" | "https" => Ok(url),
        other => Err(format!("Unsupported URL scheme: {other}")),
    }
}

fn open_in_default_browser(url: &str) -> Result<(), String> {
    Command::new("/usr/bin/xdg-open")
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("Failed to run xdg-open: {e}"))
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err("xdg-open failed".into())
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_web_urls_credentials_and_oversized_urls() {
        for raw in [
            "javascript:alert(1)",
            "file:///tmp/test",
            "custom:test",
            "https://user:secret@example.com/",
            "not a url",
        ] {
            assert!(validate_url(raw).is_err(), "{raw}");
        }
        assert!(validate_url(&format!(
            "https://example.com/{}",
            "x".repeat(MAX_URL_BYTES)
        ))
        .is_err());
        assert!(validate_url("https://example.com/?q=%24%28touch%20test%29").is_ok());
        assert!(validate_url("http://example.com/").is_ok());
    }

    #[test]
    fn bounds_frames_before_reading_payload() {
        let oversized = ((MAX_MESSAGE_BYTES + 1) as u32).to_le_bytes();
        assert_eq!(
            read_message(&mut oversized.as_slice()).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        assert!(read_message(&mut [].as_slice()).unwrap().is_none());
        let truncated = [10, 0, 0, 0, 1];
        assert!(read_message(&mut truncated.as_slice()).is_err());
        let frame = [2, 0, 0, 0, b'{', b'}'];
        assert_eq!(read_message(&mut frame.as_slice()).unwrap().unwrap(), b"{}");
    }

    #[test]
    fn invalid_requests_return_failure_without_opening_anything() {
        for payload in [
            b"{}".as_slice(),
            br#"{"url":"file:///tmp/test"}"#,
            br#"{"url":"https://user:secret@example.com/"}"#,
        ] {
            assert!(!handle(payload).ok);
        }
    }
}

fn handle(raw_message: &[u8]) -> Response {
    let request = match serde_json::from_slice::<Request>(raw_message) {
        Ok(value) => value,
        Err(err) => {
            return Response {
                ok: false,
                error: Some(format!("Invalid request payload: {err}")),
            }
        }
    };

    let parsed = match validate_url(&request.url) {
        Ok(value) => value,
        Err(err) => {
            return Response {
                ok: false,
                error: Some(err),
            }
        }
    };

    match open_in_default_browser(parsed.as_str()) {
        Ok(()) => Response {
            ok: true,
            error: None,
        },
        Err(err) => Response {
            ok: false,
            error: Some(err),
        },
    }
}

fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let stdout = io::stdout();

    let mut input = stdin.lock();
    let mut output = stdout.lock();

    while let Some(message) = read_message(&mut input)? {
        let response = handle(&message);
        write_message(&mut output, &response)?;
    }

    Ok(())
}
