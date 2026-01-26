function isWindowsStylePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || /^[A-Za-z]:$/.test(path);
}

export function normalizeFsPath(path: string): string {
  const normalized = String(path).replace(/\\/g, "/");

  // Keep drive roots as "C:/"
  const driveRoot = normalized.match(/^[A-Za-z]:\/?$/);
  if (driveRoot) return normalized.endsWith("/") ? normalized : `${normalized}/`;

  // Remove trailing slashes (but keep "/" intact)
  if (normalized === "/") return normalized;
  return normalized.replace(/\/+$/, "");
}

export function basenameFsPath(path: string): string {
  const normalized = normalizeFsPath(path);
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

export function dirnameFsPath(path: string): string {
  const normalized = normalizeFsPath(path);

  // Drive roots already normalized to "C:/"
  if (/^[A-Za-z]:\/$/.test(normalized)) return normalized;
  if (normalized === "/") return "/";

  const idx = normalized.lastIndexOf("/");
  if (idx < 0) return normalized;
  if (idx === 0) return "/";

  const parent = normalized.slice(0, idx);
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}/`;
  return parent;
}

export function isPathWithin(path: string, root: string): boolean {
  const p = normalizeFsPath(path);
  const r = normalizeFsPath(root);

  const needsCaseFold = isWindowsStylePath(p) || isWindowsStylePath(r);
  const pCmp = needsCaseFold ? p.toLowerCase() : p;
  const rCmp = needsCaseFold ? r.toLowerCase() : r;

  if (pCmp === rCmp) return true;
  const rPrefix = rCmp.endsWith("/") ? rCmp : `${rCmp}/`;
  return pCmp.startsWith(rPrefix);
}

