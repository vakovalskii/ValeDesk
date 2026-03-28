#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List


@dataclass
class SkillMeta:
    name: str
    description: str
    path: str
    capabilities: List[str]


FRONTMATTER_BOUNDARY = re.compile(r"^---\s*$")
YAML_KV = re.compile(r"^([A-Za-z0-9_-]+)\s*:\s*(.*)\s*$")


def parse_frontmatter(text: str) -> Dict[str, str]:
    lines = text.splitlines()
    if not lines or not FRONTMATTER_BOUNDARY.match(lines[0]):
        return {}
    out: Dict[str, str] = {}
    i = 1
    while i < len(lines):
        if FRONTMATTER_BOUNDARY.match(lines[i]):
            break
        m = YAML_KV.match(lines[i])
        if m:
            k, v = m.group(1), m.group(2)
            if len(v) >= 2 and ((v[0] == v[-1] == '"') or (v[0] == v[-1] == "'")):
                v = v[1:-1]
            out[k] = v
        i += 1
    return out


def find_skill_files(skills_root: Path) -> List[Path]:
    if not skills_root.exists():
        return []
    return sorted(skills_root.rglob("SKILL.md"))


def derive_name_from_path(skill_file: Path, skills_root: Path) -> str:
    try:
        rel = skill_file.relative_to(skills_root)
        return rel.parts[0]
    except Exception:
        return skill_file.parent.name


def build_manifest(repo_root: Path) -> Dict[str, Any]:
    skills_root = repo_root / ".cursor" / "skills"
    skill_files = find_skill_files(skills_root)

    skills: List[SkillMeta] = []
    for sf in skill_files:
        text = sf.read_text(encoding="utf-8", errors="replace")
        fm = parse_frontmatter(text)
        name = (fm.get("name") or "").strip() or derive_name_from_path(sf, skills_root)
        desc = (fm.get("description") or "").strip()
        caps_raw = (fm.get("capabilities") or "").strip()
        caps = []
        if caps_raw:
            caps_raw = caps_raw.strip()
            if caps_raw.startswith("[") and caps_raw.endswith("]"):
                caps_raw = caps_raw[1:-1]
            caps = [c.strip() for c in caps_raw.split(",") if c.strip()]
        skills.append(SkillMeta(name=name, description=desc, path=str(sf.as_posix()), capabilities=caps))

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "repo_root": str(repo_root.as_posix()),
        "skills_root": str(skills_root.as_posix()),
        "skills": [
            {
                "name": s.name,
                "description": s.description,
                "path": s.path,
                "scope": "project",
                "capabilities": s.capabilities,
            }
            for s in sorted(skills, key=lambda x: x.name.lower())
        ],
    }


def main() -> None:
    repo_root = Path(os.getcwd()).resolve()
    manifest_path = repo_root / ".cursor" / "skills" / "skills-manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest = build_manifest(repo_root)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"OK: wrote {manifest_path.as_posix()} (skills={len(manifest['skills'])})")


if __name__ == "__main__":
    main()

