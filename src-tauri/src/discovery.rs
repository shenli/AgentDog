/// Utility for converting Claude Code's sanitized project directory names back to paths.
/// This is Claude Code-specific: it stores projects as hyphen-separated path segments.

pub fn unsanitize_path(sanitized: &str) -> String {
    // "-Users-lishen-work-claude-code-source-code" -> "/Users/lishen/work/claude-code-source-code"
    let raw = if sanitized.starts_with('-') {
        &sanitized[1..]
    } else {
        sanitized
    };

    let parts: Vec<&str> = raw.split('-').collect();

    if let Some(path) = reconstruct_path(&parts, 0, String::from("/")) {
        let result = path;
        if let Some(home) = dirs::home_dir() {
            let home_str = home.to_string_lossy();
            if result.starts_with(home_str.as_ref()) {
                return format!("~{}", &result[home_str.len()..]);
            }
        }
        return result;
    }

    // Fallback: naive replace (every hyphen -> /)
    let guess = format!("/{}", raw).replace('-', "/");
    if let Some(home) = dirs::home_dir() {
        let home_str = home.to_string_lossy();
        if guess.starts_with(home_str.as_ref()) {
            return format!("~{}", &guess[home_str.len()..]);
        }
    }
    guess
}

/// Greedily reconstruct a filesystem path from hyphen-separated parts.
fn reconstruct_path(parts: &[&str], start: usize, prefix: String) -> Option<String> {
    if start >= parts.len() {
        return Some(prefix);
    }

    for end in (start + 1..=parts.len()).rev() {
        let segment = parts[start..end].join("-");
        let candidate = if prefix == "/" {
            format!("/{}", segment)
        } else {
            format!("{}/{}", prefix, segment)
        };

        if end == parts.len() {
            if std::path::Path::new(&candidate).exists() {
                return Some(candidate);
            }
        } else {
            if std::path::Path::new(&candidate).is_dir() {
                if let Some(result) = reconstruct_path(parts, end, candidate) {
                    return Some(result);
                }
            }
        }
    }

    None
}
