# Security Features

## Workspace Sandboxing

ValeDesk implements multiple layers of security to ensure that the AI agent can only access files within the user-specified workspace folder.

### Protection Mechanisms

#### 1. Path Normalization
All file paths are normalized using `path.normalize()` to prevent path traversal attacks using techniques like:
- `../../../etc/passwd`
- `..\\..\\..\\Windows\\System32`
- `./../sensitive-folder/`

#### 2. Symlink Resolution
The system uses `fs.realpathSync()` to resolve symbolic links, preventing attacks where a symlink points outside the workspace:
```
workspace/
  ├── safe.txt
  └── malicious-link -> /etc/passwd  ❌ BLOCKED
```

#### 3. Absolute Path Verification
Before any file operation, the system verifies that the resolved absolute path:
- Starts with the workspace folder path
- Does not escape the workspace through any means
- Uses proper path separator handling for cross-platform compatibility

#### 4. Multi-Layer Checks
```typescript
isPathSafe(filePath: string): boolean {
  // 1. Normalize input (removes .., ./, etc.)
  // 2. Resolve to absolute path
  // 3. Resolve symlinks (prevents symlink attacks)
  // 4. Verify path is within workspace
  // 5. Log security violations
}
```

### Protected Operations

File operations that require workspace validation:
- **Read** - Reading file contents
- **Write** - Creating new files
- **Edit** - Modifying existing files
- **Bash** - Executing shell commands

### No Workspace Mode

Users can start a chat **without** a workspace folder. In this mode:
- ✅ General conversation works normally
- ✅ Web search is available
- ❌ File operations are blocked with helpful error messages
- 💡 User is guided to create a new chat with a workspace folder if needed

### Example Security Violations

All of these attempts will be **blocked** and logged:

```javascript
// Attempt 1: Path traversal
Read file: "../../../etc/passwd"
❌ BLOCKED: Path outside workspace

// Attempt 2: Absolute path
Write file: "/tmp/malicious.sh"
❌ BLOCKED: Path outside workspace

// Attempt 3: Symlink escape
Read file: "symlink-to-root"
❌ BLOCKED: Resolved path outside workspace

// Attempt 4: Unicode/URL encoding tricks
Read file: "%2e%2e%2f%2e%2e%2fetc%2fpasswd"
❌ BLOCKED: Normalized path outside workspace
```

### Security Logs

All security violations are logged to the console:
```
[Security] Blocked access to path outside working directory:
  Requested: ../../../etc/passwd
  Resolved: /etc/passwd
  Working dir: /Users/john/my-project
```

### Best Practices

1. **Always verify workspace selection** - Make sure users select the correct folder
2. **Review logs** - Check console for any suspicious file access attempts
3. **Limit permissions** - Run the application with minimal system permissions
4. **Update regularly** - Keep dependencies updated for security patches

### Technical Details

- **Platform**: Cross-platform (Windows, macOS, Linux)
- **Path separator handling**: Automatic detection and normalization
- **Symlink protection**: Full resolution before validation
- **Case sensitivity**: Platform-appropriate handling

## Reporting Security Issues

If you discover a security vulnerability, please email: [your-email@example.com]

**Do NOT** create a public GitHub issue for security vulnerabilities.
