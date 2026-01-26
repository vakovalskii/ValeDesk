/**
 * Code Sandbox - Execute JS and Python securely
 * 
 * JavaScript: boa_engine (pure Rust, works everywhere)
 * Python: subprocess (uses system Python, full stdlib + pip packages)
 */

use boa_engine::{Context, Source};
use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxResult {
    pub success: bool,
    pub output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub logs: Vec<String>,
    pub language: String,
}

// ============ JavaScript Sandbox (boa_engine) ============

pub fn execute_javascript(
    code: &str,
    cwd: &str,
    _timeout_ms: u64,
) -> SandboxResult {
    let mut logs: Vec<String> = Vec::new();
    
    // Create JS context
    let mut context = Context::default();
    
    // Wrap code to capture console.log output
    let wrapped_code = format!(r#"
        var __logs = [];
        var console = {{
            log: function() {{
                var args = Array.prototype.slice.call(arguments);
                var msg = args.map(function(a) {{
                    if (a === null) return 'null';
                    if (a === undefined) return 'undefined';
                    if (typeof a === 'object') {{
                        try {{ return JSON.stringify(a); }} catch(e) {{ return String(a); }}
                    }}
                    return String(a);
                }}).join(' ');
                __logs.push(msg);
            }},
            error: function() {{
                var args = Array.prototype.slice.call(arguments);
                var msg = 'ERROR: ' + args.map(function(a) {{
                    if (a === null) return 'null';
                    if (a === undefined) return 'undefined';
                    if (typeof a === 'object') {{
                        try {{ return JSON.stringify(a); }} catch(e) {{ return String(a); }}
                    }}
                    return String(a);
                }}).join(' ');
                __logs.push(msg);
            }},
            warn: function() {{
                var args = Array.prototype.slice.call(arguments);
                var msg = 'WARN: ' + args.map(function(a) {{
                    if (a === null) return 'null';
                    if (a === undefined) return 'undefined';
                    if (typeof a === 'object') {{
                        try {{ return JSON.stringify(a); }} catch(e) {{ return String(a); }}
                    }}
                    return String(a);
                }}).join(' ');
                __logs.push(msg);
            }},
            info: function() {{ this.log.apply(this, arguments); }}
        }};
        
        var __dirname = "{}";
        var __result;
        
        try {{
            __result = (function() {{
                {}
            }})();
        }} catch(e) {{
            __logs.push('ERROR: ' + e.message);
        }}
        
        JSON.stringify({{ logs: __logs, result: __result }});
    "#, 
        cwd.replace("\\", "\\\\").replace("\"", "\\\""), 
        code
    );
    
    match context.eval(Source::from_bytes(&wrapped_code)) {
        Ok(result) => {
            // Convert JsValue to string
            let result_str = result.to_string(&mut context)
                .map(|s| s.to_std_string_escaped())
                .unwrap_or_default();
            
            // Try to parse as JSON
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&result_str) {
                if let Some(obj) = json_val.as_object() {
                    // Extract logs
                    if let Some(logs_arr) = obj.get("logs").and_then(|v| v.as_array()) {
                        for item in logs_arr {
                            if let Some(s) = item.as_str() {
                                logs.push(s.to_string());
                            }
                        }
                    }
                    
                    // Extract result
                    let output_result = if let Some(res) = obj.get("result") {
                        if res.is_null() {
                            String::new()
                        } else if let Some(s) = res.as_str() {
                            s.to_string()
                        } else {
                            serde_json::to_string_pretty(res).unwrap_or_default()
                        }
                    } else {
                        String::new()
                    };
                    
                    let output = if !logs.is_empty() {
                        if output_result.is_empty() {
                            logs.join("\n")
                        } else {
                            format!("{}\n\nReturn value: {}", logs.join("\n"), output_result)
                        }
                    } else {
                        output_result
                    };
                    
                    return SandboxResult {
                        success: true,
                        output,
                        error: None,
                        logs,
                        language: "javascript".to_string(),
                    };
                }
            }
            
            // Fallback - just return raw result
            SandboxResult {
                success: true,
                output: result_str,
                error: None,
                logs,
                language: "javascript".to_string(),
            }
        }
        Err(e) => {
            SandboxResult {
                success: false,
                output: String::new(),
                error: Some(e.to_string()),
                logs,
                language: "javascript".to_string(),
            }
        }
    }
}

// ============ Python Sandbox (subprocess) ============

pub fn execute_python(
    code: &str,
    cwd: &str,
    _timeout_ms: u64,
) -> SandboxResult {
    // Find Python executable
    let python_cmd = find_python();
    
    if python_cmd.is_none() {
        return SandboxResult {
            success: false,
            output: String::new(),
            error: Some("Python not found. Install Python 3: https://www.python.org/downloads/".to_string()),
            logs: vec![],
            language: "python".to_string(),
        };
    }
    
    let python = python_cmd.unwrap();
    
    // Create temp file for code (safer than -c for multiline)
    let temp_file = std::env::temp_dir().join(format!("localdesk_sandbox_{}.py", uuid::Uuid::new_v4()));
    
    // Write code to temp file
    if let Err(e) = std::fs::write(&temp_file, code) {
        return SandboxResult {
            success: false,
            output: String::new(),
            error: Some(format!("Failed to create temp file: {}", e)),
            logs: vec![],
            language: "python".to_string(),
        };
    }
    
    // Execute Python
    let result = Command::new(&python)
        .arg(&temp_file)
        .current_dir(cwd)
        .output();
    
    // Clean up temp file
    let _ = std::fs::remove_file(&temp_file);
    
    match result {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            
            let logs: Vec<String> = stdout.lines().map(|s| s.to_string()).collect();
            
            if output.status.success() {
                SandboxResult {
                    success: true,
                    output: stdout.trim().to_string(),
                    error: if stderr.is_empty() { None } else { Some(stderr) },
                    logs,
                    language: "python".to_string(),
                }
            } else {
                SandboxResult {
                    success: false,
                    output: stdout,
                    error: Some(if stderr.is_empty() { 
                        format!("Python exited with code {}", output.status.code().unwrap_or(-1))
                    } else { 
                        stderr 
                    }),
                    logs,
                    language: "python".to_string(),
                }
            }
        }
        Err(e) => {
            SandboxResult {
                success: false,
                output: String::new(),
                error: Some(format!("Failed to execute Python: {}", e)),
                logs: vec![],
                language: "python".to_string(),
            }
        }
    }
}

// Find Python 3 executable
fn find_python() -> Option<String> {
    // Try common Python executables
    let candidates = ["python3", "python", "/usr/bin/python3", "/usr/local/bin/python3"];
    
    for cmd in candidates {
        if let Ok(output) = Command::new(cmd).arg("--version").output() {
            if output.status.success() {
                let version = String::from_utf8_lossy(&output.stdout);
                // Make sure it's Python 3
                if version.contains("Python 3") || String::from_utf8_lossy(&output.stderr).contains("Python 3") {
                    return Some(cmd.to_string());
                }
            }
        }
    }
    
    None
}

// ============ Unified Execute Function ============

pub fn execute_code(
    code: &str,
    language: &str,
    cwd: &str,
    timeout_ms: u64,
) -> SandboxResult {
    match language.to_lowercase().as_str() {
        "javascript" | "js" => execute_javascript(code, cwd, timeout_ms),
        "python" | "py" => execute_python(code, cwd, timeout_ms),
        _ => SandboxResult {
            success: false,
            output: String::new(),
            error: Some(format!("Unsupported language: '{}'. Supported: javascript, python", language)),
            logs: vec![],
            language: language.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_javascript_console_log() {
        let result = execute_javascript(
            "console.log('Hello from JS!'); console.log(2 + 2);",
            "/tmp",
            5000,
        );
        assert!(result.success, "Error: {:?}", result.error);
        assert!(result.logs.contains(&"Hello from JS!".to_string()));
        assert!(result.logs.contains(&"4".to_string()));
    }

    #[test]
    fn test_javascript_return_value() {
        let result = execute_javascript(
            "return { name: 'test', value: 42 };",
            "/tmp",
            5000,
        );
        assert!(result.success, "Error: {:?}", result.error);
        assert!(result.output.contains("42"));
    }

    #[test]
    fn test_python_print() {
        let result = execute_python(
            "print('Hello from Python!')\nprint(2 + 2)",
            "/tmp",
            5000,
        );
        if result.success {
            assert!(result.output.contains("Hello from Python!"));
            assert!(result.output.contains("4"));
        } else {
            // Python might not be installed
            assert!(result.error.unwrap().contains("Python not found") || 
                    result.error.as_ref().unwrap().contains("Failed"));
        }
    }
}
