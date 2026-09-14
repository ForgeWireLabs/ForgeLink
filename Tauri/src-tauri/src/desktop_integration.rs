use tauri::{AppHandle, Manager};
use url::Url;

pub fn activate_main_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "ForgeLink main window is unavailable.".to_string())?;
    if window
        .is_minimized()
        .map_err(|_| "ForgeLink could not inspect the main window.".to_string())?
    {
        window
            .unminimize()
            .map_err(|_| "ForgeLink could not restore the main window.".to_string())?;
    }
    window
        .show()
        .map_err(|_| "ForgeLink could not show the main window.".to_string())?;
    window
        .set_focus()
        .map_err(|_| "ForgeLink could not focus the main window.".to_string())
}

pub fn open_external(app: &AppHandle, raw: &str) -> Result<(), String> {
    if raw.len() > 2048
        || raw
            .chars()
            .any(|character| character.is_ascii_control() || character.is_ascii_whitespace())
    {
        return Err("Only a bounded HTTPS URL may be opened externally.".to_string());
    }
    let url = Url::parse(raw)
        .map_err(|_| "Only a valid HTTPS URL may be opened externally.".to_string())?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Only a credential-free HTTPS URL may be opened externally.".to_string());
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(raw, None::<&str>)
        .map_err(|_| "ForgeLink could not open the external URL.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_credential_free_https_urls_are_accepted_by_the_parser() {
        for raw in [
            "https://example.com/docs",
            "https://example.com/open?ref=forgelink",
        ] {
            let url = Url::parse(raw).expect("valid URL");
            assert_eq!(url.scheme(), "https");
            assert!(url.host_str().is_some());
            assert!(url.username().is_empty());
        }
        for raw in [
            "http://example.com",
            "forgelink://open/settings",
            "https://user:secret@example.com",
            "https://example.com\n/unsafe",
        ] {
            let accepted = Url::parse(raw).is_ok()
                && raw.len() <= 2048
                && !raw.chars().any(|character| {
                    character.is_ascii_control() || character.is_ascii_whitespace()
                })
                && Url::parse(raw).is_ok_and(|url| {
                    url.scheme() == "https"
                        && url.host_str().is_some()
                        && url.username().is_empty()
                        && url.password().is_none()
                });
            assert!(!accepted, "{raw}");
        }
    }
}
