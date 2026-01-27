.PHONY: dev dev-sidecar dev-ui dev-tauri check-tools ensure-tools ensure-node-deps ensure-tauri-cli ensure-rust bundle

VALERA_ROOT := $(CURDIR)
SIDECAR_ENTRY := $(VALERA_ROOT)/dist-sidecar/sidecar/main.js
MIN_RUST_VERSION := 1.74.0

check-tools:
ifdef OS
	@powershell -ExecutionPolicy ByPass -File ./scripts/ensure_deps.ps1
else
	@./scripts/ensure_deps.sh
endif

ensure-node-deps: check-tools
ifdef OS
	@powershell -ExecutionPolicy ByPass -File ./scripts/ensure_node_deps.ps1
else
	@test -f package-lock.json || { echo "level=error event=missing_file file=package-lock.json msg=\"package-lock.json is required for npm ci\"" >&2; exit 1; }
	@if [ ! -d node_modules ]; then \
		echo "level=info event=install deps=npm msg=\"node_modules not found; running npm ci\""; \
		npm ci; \
		echo "level=info event=rebuild module=better-sqlite3 msg=\"rebuilding native module for current Node.js\""; \
		npm rebuild better-sqlite3; \
	fi
endif

ensure-rust:
ifdef OS
	@powershell -ExecutionPolicy ByPass -File ./scripts/ensure_rust.ps1 -MinRustVersion "$(MIN_RUST_VERSION)"
else
	@echo "Checking Rust version..."
	@if ! command -v rustc >/dev/null 2>&1; then \
		echo ""; \
		echo "❌ ERROR: Rust is not installed"; \
		echo ""; \
		echo "Install Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"; \
		echo ""; \
		exit 1; \
	fi
	@RUST_VERSION=$$(rustc --version | sed 's/rustc \([0-9]*\.[0-9]*\.[0-9]*\).*/\1/'); \
	MIN_VERSION="$(MIN_RUST_VERSION)"; \
	RUST_MAJOR=$$(echo $$RUST_VERSION | cut -d. -f1); \
	RUST_MINOR=$$(echo $$RUST_VERSION | cut -d. -f2); \
	RUST_PATCH=$$(echo $$RUST_VERSION | cut -d. -f3); \
	MIN_MAJOR=$$(echo $$MIN_VERSION | cut -d. -f1); \
	MIN_MINOR=$$(echo $$MIN_VERSION | cut -d. -f2); \
	MIN_PATCH=$$(echo $$MIN_VERSION | cut -d. -f3); \
	if [ $$RUST_MAJOR -lt $$MIN_MAJOR ] || \
	   ([ $$RUST_MAJOR -eq $$MIN_MAJOR ] && [ $$RUST_MINOR -lt $$MIN_MINOR ]) || \
	   ([ $$RUST_MAJOR -eq $$MIN_MAJOR ] && [ $$RUST_MINOR -eq $$MIN_MINOR ] && [ $$RUST_PATCH -lt $$MIN_PATCH ]); then \
		echo ""; \
		echo "❌ ERROR: Rust version $$RUST_VERSION is too old (minimum: $$MIN_VERSION)"; \
		echo ""; \
		echo "Update Rust: rustup update stable"; \
		echo ""; \
		exit 1; \
	fi
	@echo "✓ Rust $$(rustc --version | sed 's/rustc \([0-9]*\.[0-9]*\.[0-9]*\).*/\1/') (minimum: $(MIN_RUST_VERSION))"
endif

ensure-tauri-cli: ensure-rust
ifdef OS
	@powershell -ExecutionPolicy ByPass -File ./scripts/ensure_tauri_cli.ps1
else
	@if ! command -v cargo-tauri >/dev/null 2>&1; then \
		echo "level=info event=install tool=cargo-tauri cmd=\"cargo install tauri-cli --locked\" msg=\"cargo-tauri not found; installing tauri-cli\""; \
		cargo install tauri-cli --locked; \
	fi
	@command -v cargo-tauri >/dev/null 2>&1 || { \
		echo "level=error event=install_failed tool=cargo-tauri msg=\"cargo-tauri still not found after install; ensure $$CARGO_HOME/bin (or $$HOME/.cargo/bin) is in PATH\"" >&2; \
		exit 1; \
	}
endif

ensure-tools:
	@$(MAKE) --no-print-directory check-tools
	@$(MAKE) --no-print-directory ensure-rust
	@$(MAKE) --no-print-directory ensure-node-deps
	@$(MAKE) --no-print-directory ensure-tauri-cli

dev-sidecar: ensure-tools
	@npm run transpile:sidecar
ifdef OS
	@powershell -ExecutionPolicy ByPass -File ./scripts/setup_sidecar_mock.ps1
else
	@./scripts/setup_sidecar_mock.sh
endif

dev-ui: ensure-tools
	@npm run dev:react

dev-tauri: ensure-tools
	@cd src-tauri && VALERA_SIDECAR_ENTRY="$(SIDECAR_ENTRY)" cargo tauri dev

dev: dev-sidecar
	@echo "Starting Vite + Tauri (Node-sidecar)..."
ifdef OS
	@node scripts/dev-tauri.cjs
else
	@npm run dev:react & \
	VITE_PID=$$!; \
	cd src-tauri && VALERA_SIDECAR_ENTRY="$(SIDECAR_ENTRY)" cargo tauri dev; \
	STATUS=$$?; \
	kill $$VITE_PID >/dev/null 2>&1 || true; \
	exit $$STATUS
endif

bundle: ensure-tools
	@echo "Building UI..."
	@npm run build
	@echo "Building sidecar binary..."
ifdef OS
	@powershell -Command "if (-not (Test-Path src-tauri\bin)) { New-Item -ItemType Directory -Path src-tauri\bin | Out-Null }"
else
	@mkdir -p src-tauri/bin
endif
	@npm run build:sidecar
	@echo "Building Tauri bundle..."
	@cd src-tauri && cargo tauri build
