#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List


ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
PKG_RE = re.compile(r"^([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)@([A-Za-z0-9_.-]+)\s*$")
URL_RE = re.compile(r"(https?://\S+)")
NPX = "npx.cmd" if os.name == "nt" else "npx"


def strip_ansi(s: str) -> str:
    return ANSI_RE.sub("", s)


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_manifest(repo_root: Path) -> Dict[str, Any]:
    mp = repo_root / ".cursor" / "skills" / "skills-manifest.json"
    if not mp.exists():
        return {"skills": []}
    return read_json(mp, {"skills": []})


def load_capabilities(repo_root: Path) -> Dict[str, Any]:
    cap_path = repo_root / ".cursor" / "skills" / "auto-skill-bootstrap" / "capabilities.json"
    return read_json(cap_path, {})


def load_trust_policy(repo_root: Path) -> Dict[str, Any]:
    tp_path = repo_root / ".cursor" / "skills" / "auto-skill-bootstrap" / "trust-policy.json"
    return read_json(tp_path, {"mode": "allowlist_only", "allow": [], "deny": ["*/*"], "min_stars": 0})


def glob_match(pattern: str, value: str) -> bool:
    if pattern == value:
        return True
    parts = pattern.split("*")
    if len(parts) == 1:
        return False
    pos = 0
    for i, p in enumerate(parts):
        if not p:
            continue
        idx = value.find(p, pos)
        if idx < 0:
            return False
        if i == 0 and not value.startswith(p) and not pattern.startswith("*"):
            return False
        pos = idx + len(p)
    if not pattern.endswith("*") and parts[-1] and not value.endswith(parts[-1]):
        return False
    return True


def is_allowlisted(owner_repo: str, policy: Dict[str, Any]) -> bool:
    allow = policy.get("allow", []) or []
    deny = policy.get("deny", []) or []
    mode = policy.get("mode", "allowlist_only")
    denied = any(glob_match(p, owner_repo) for p in deny)
    allowed = any(glob_match(p, owner_repo) for p in allow)
    if mode == "allowlist_only":
        return allowed and not denied
    return (allowed and not denied)


def skill_covers_capability(skill: Dict[str, Any], capdef: Dict[str, Any], fallback_cap: str) -> bool:
    declared = skill.get("capabilities") or []
    if declared:
        return fallback_cap in declared
    hay = f"{skill.get('name','')} {skill.get('description','')}".lower()
    kws = (capdef.get("keywords") or [fallback_cap])
    return any(k.lower() in hay for k in kws)


def compute_coverage(manifest: Dict[str, Any], caps: List[str], capdefs: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    covered: Dict[str, List[Dict[str, Any]]] = {}
    skills = manifest.get("skills", []) or []
    # Meta-skills are procedural and should NOT be treated as domain coverage.
    meta_names = {"find-skills", "auto-skill-bootstrap", "sandbox-framework"}
    skills = [s for s in skills if (s.get("name") or "").strip() not in meta_names]
    for cap in caps:
        capdef = capdefs.get(cap, {"keywords": [cap]})
        hits = [s for s in skills if skill_covers_capability(s, capdef, cap)]
        covered[cap] = hits
    return covered


def run_skills_find(query: str) -> str:
    proc = subprocess.run(
        [NPX, "--yes", "skills", "find", query],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"skills find failed for query='{query}' (exit {proc.returncode})\n{proc.stdout}")
    return proc.stdout


def parse_find_output(out: str) -> List[Dict[str, str]]:
    lines = [strip_ansi(l).rstrip() for l in out.splitlines()]
    items: List[Dict[str, str]] = []
    i = 0
    while i < len(lines):
        m = PKG_RE.match(lines[i].strip())
        if m:
            owner_repo = m.group(1)
            skill = m.group(2)
            url = ""
            if i + 1 < len(lines):
                um = URL_RE.search(lines[i + 1].strip())
                if um:
                    url = um.group(1)
            items.append({"package": f"{owner_repo}@{skill}", "owner_repo": owner_repo, "skill": skill, "url": url})
            i += 2
            continue
        i += 1
    seen = set()
    uniq = []
    for it in items:
        key = it["package"]
        if key in seen:
            continue
        seen.add(key)
        uniq.append(it)
    return uniq


def install_skill(package: str) -> None:
    proc = subprocess.run(
        [NPX, "--yes", "skills", "add", package, "-y"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"skills add failed for package='{package}' (exit {proc.returncode})\n{proc.stdout}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cap", action="append", default=[], help="capability (repeatable)")
    ap.add_argument("--no-install", action="store_true", help="only search and write candidates.json")
    ap.add_argument("--install-allowlisted", action="store_true", help="install allowlisted candidates automatically")
    ap.add_argument("--max-per-cap", type=int, default=1, help="max auto-installs per capability (allowlisted only)")
    args = ap.parse_args()

    repo_root = Path(os.getcwd()).resolve()
    manifest = load_manifest(repo_root)
    capdefs = load_capabilities(repo_root)
    policy = load_trust_policy(repo_root)

    caps = [c.strip() for c in args.cap if c and c.strip()]
    if not caps:
        raise SystemExit("No capabilities provided. Use --cap <capability> (repeatable).")

    covered = compute_coverage(manifest, caps, capdefs)
    missing = [c for c in caps if not covered.get(c)]

    out_dir = repo_root / ".cursor" / "skills" / "auto-skill-bootstrap"
    state_path = out_dir / "state.json"
    candidates_path = out_dir / "candidates.json"

    state = read_json(state_path, {})
    now = datetime.now(timezone.utc).isoformat()
    state["updated_at"] = now
    state["caps"] = caps
    state["missing_caps"] = missing

    candidates: Dict[str, Any] = {"generated_at": now, "caps": caps, "missing_caps": missing, "by_cap": {}}

    for cap in missing:
        capdef = capdefs.get(cap, {})
        queries = capdef.get("queries") or [cap]
        found: List[Dict[str, str]] = []
        for q in queries:
            raw = run_skills_find(str(q))
            found.extend(parse_find_output(raw))
        seen = set()
        dedup = []
        for it in found:
            if it["package"] in seen:
                continue
            seen.add(it["package"])
            it["allowlisted"] = is_allowlisted(it["owner_repo"], policy)
            dedup.append(it)
        candidates["by_cap"][cap] = {"queries": queries, "candidates": dedup}

    write_json(candidates_path, candidates)

    installed: Dict[str, List[str]] = {}
    if args.install_allowlisted and not args.no_install:
        for cap, block in candidates.get("by_cap", {}).items():
            allow = [c for c in block.get("candidates", []) if c.get("allowlisted")]
            if not allow:
                continue
            to_install = allow[: max(0, args.max_per_cap)]
            installed[cap] = []
            for it in to_install:
                install_skill(it["package"])
                installed[cap].append(it["package"])

    state["installed"] = installed
    write_json(state_path, state)

    print(f"OK: wrote {candidates_path.as_posix()}")
    print(f"OK: updated {state_path.as_posix()}")
    if installed:
        print("Installed:")
        for cap, pkgs in installed.items():
            for p in pkgs:
                print(f"- {cap}: {p}")
    else:
        print("Installed: none")


if __name__ == "__main__":
    main()

