.PHONY: dev dev-sidecar dev-ui dev-tauri check-tools ensure-tools ensure-node-deps ensure-tauri-cli bundle

LOCALDESK_ROOT := $(CURDIR)
SIDECAR_ENTRY := $(LOCALDESK_ROOT)/dist-sidecar/sidecar/main.js

check-tools:
ifdef OS
	@powershell -ExecutionPolicy ByPass -File ./scripts/ensure_deps.ps1
else
	@./scripts/ensure_deps.sh
endif

ensure-node-deps: check-tools
	@test -f package-lock.json || { echo "level=error event=missing_file file=package-lock.json msg=\"package-lock.json is required for npm ci\"" >&2; exit 1; }
	@if [ ! -d node_modules ]; then \
		echo "level=info event=install deps=npm msg=\"node_modules not found; running npm ci\""; \
		npm ci; \
	fi

ensure-tauri-cli: check-tools
	@if ! command -v cargo-tauri >/dev/null 2>&1; then \
		echo "level=info event=install tool=cargo-tauri cmd=\"cargo install tauri-cli --locked\" msg=\"cargo-tauri not found; installing tauri-cli\""; \
		cargo install tauri-cli --locked; \
	fi
	@command -v cargo-tauri >/dev/null 2>&1 || { \
		echo "level=error event=install_failed tool=cargo-tauri msg=\"cargo-tauri still not found after install; ensure $$CARGO_HOME/bin (or $$HOME/.cargo/bin) is in PATH\"" >&2; \
		exit 1; \
	}

ensure-tools:
	@$(MAKE) --no-print-directory check-tools
	@$(MAKE) --no-print-directory ensure-node-deps
	@$(MAKE) --no-print-directory ensure-tauri-cli

dev-sidecar: ensure-tools
	@npm run transpile:sidecar

dev-ui: ensure-tools
	@npm run dev:react

dev-tauri: ensure-tools
	@cd src-tauri && LOCALDESK_SIDECAR_ENTRY="$(SIDECAR_ENTRY)" cargo tauri dev

dev: dev-sidecar
	@echo "Starting Vite + Tauri (Node-sidecar)..."
	@npm run dev:react & \
	VITE_PID=$$!; \
	cd src-tauri && LOCALDESK_SIDECAR_ENTRY="$(SIDECAR_ENTRY)" cargo tauri dev; \
	STATUS=$$?; \
	kill $$VITE_PID >/dev/null 2>&1 || true; \
	exit $$STATUS

bundle: ensure-tools
	@echo "Building UI..."
	@npm run build
	@echo "Building sidecar binary..."
	@mkdir -p src-tauri/bin
	@npm run build:sidecar
	@echo "Building Tauri bundle..."
	@cd src-tauri && cargo tauri build
