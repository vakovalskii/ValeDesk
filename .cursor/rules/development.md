# Development Guidelines

## Code Style

### TypeScript
- Strict mode enabled (`strict: true`)
- Use `type` imports for type-only imports
- Prefer `interface` for object shapes, `type` for unions/primitives
- No `any` unless absolutely necessary (document why)

### Naming Conventions
- Files: `kebab-case.ts` (e.g., `tools-executor.ts`)
- Classes: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Tool names: `snake_case` with `verb_noun` pattern (e.g., `read_file`, `search_web`)

### File Organization
```
src/
├── electron/           # Main process (Node.js)
│   ├── main.ts        # Entry point
│   ├── ipc-handlers.ts
│   └── libs/          # Core logic
└── ui/                # Renderer process (React)
    ├── App.tsx
    ├── components/
    └── store/
```

## Git Workflow

### Commit Messages
Format: `type: description`

Types:
- `feat:` New feature
- `fix:` Bug fix
- `refactor:` Code refactoring
- `chore:` Maintenance tasks
- `security:` Security fixes
- `perf:` Performance improvements

Examples:
```
feat: add PDF document extraction tool
fix: resolve streaming UI lag on large responses
refactor: extract tool executor into separate module
security: replace hardcoded URLs with environment variables
```

### Branch Naming
- `feature/description` - new features
- `fix/description` - bug fixes
- `hotfix/description` - urgent production fixes

## Testing Flow

### Before Committing
1. Run `npm run lint` - fix all errors
2. Run `npm run type-check` - ensure no TypeScript errors
3. Test manually in dev mode: `npm run dev`

### Testing New Tools
1. Add tool definition to `src/electron/libs/tools/`
2. Register in `src/electron/libs/tools/index.ts`
3. Test via chat interface with various inputs
4. Test error cases (invalid input, permission denied, etc.)

## Development Commands

```bash
# Start development (macOS/Linux)
npm run dev

# Start development (Windows)
npm run dev:win

# Type check without building
npm run type-check

# Lint code
npm run lint

# Build for production
npm run build

# Build distributables
npm run dist:mac    # macOS
npm run dist:win    # Windows
npm run dist:linux  # Linux
```

## Environment Variables

Create `.env` file (gitignored):
```
TAVILY_API_KEY=tvly-xxx
ZAI_API_KEY=xxx
VLLM_URL=http://localhost:8000/v1
```

## Performance Guidelines

1. **Streaming UI**: Use `requestAnimationFrame` for UI updates during streaming
2. **No blocking operations**: Use async/await in main process
3. **Memory**: Avoid storing large objects in memory; stream when possible
4. **Logging**: Keep logs minimal in production; use `console.log` only for debugging
