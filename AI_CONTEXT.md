# ContextForge — AI Development Blueprint

This file serves as the comprehensive context for any AI coding assistant working on this codebase. It outlines the project's architecture, core concepts, and development standards.

---

## 1. Project Essence
**ContextForge** is a production-ready VS Code extension designed as a "Prompt Intelligence Layer". It transforms rough, low-context user ideas into professional, codebase-aware prompts optimized for AI Agents (Claude Code, Codex, Cursor, etc.).

### Core Workflow:
`Rough Prompt` → `Workspace Scan` → `SearXNG Web Research` → `Ambiguity Detection (Questions)` → `Refined Prompt` → `Agent File Sync`.

---

## 2. Technical Architecture

### 2.1 The 3-Layer Provider System (`src/providers.ts`)
We use a `ProviderFactory` to instantiate LLM adapters:
- **Layer 1 (Native):** Gemini (Google) and Anthropic (Claude).
- **Layer 2 (OpenAI-Compatible):** Groq, DeepSeek, local LLMs.
- **Layer 3 (Generic HTTP):** A template-based adapter that can wrap *any* custom API using JSON templates and dot-notation response extraction.

### 2.2 Security Standards (Strict)
- **API Keys:** MUST ONLY be stored in VS Code `SecretStorage`. NEVER write keys to files or logs.
- **Redaction:** Every diagnostic output must pass through `redactSensitiveData` (`src/utils.ts`) to scrub Bearer tokens, x-api-key, and URL params.
- **Workspace Config:** `.contextforge/providers.json` contains non-secret metadata only.

### 2.3 Synchronization Layer (`src/agentSync.ts`)
- We inject refined prompts into agent files (e.g., `AGENTS.md`, `.cursor/rules/contextforge.mdc`).
- **Safety:** Always use `<!-- contextforge:start -->` and `<!-- contextforge:end -->` markers.
- **Backup:** A `.contextforge.backup` file is created before any file modification.

---

## 3. Directory Structure & Key Files
- `src/extension.ts`: Main entry point and command registration (Panel + One-click commands).
- `src/providers.ts`: **Centralized** file for all LLM provider logic (Native, OpenAI, Generic).
- `src/promptPipeline.ts`: The orchestrator that runs the refinement sequence.
- `src/providerConfig.ts`: Manages the workspace-level `.contextforge/providers.json` and SecretStorage.
- `src/workspace.ts`: Logic for scanning the codebase (tech stack detection, project summary).
- `src/searxng.ts`: Local web-search integration client.
- `test/`: Mocha/Chai unit tests with a custom VS Code mock (`test/mockVscode.ts`).

---

## 4. Development Guidelines for AI
1. **Consolidation:** Keep provider logic merged in `src/providers.ts` as per user preference.
2. **One-Click UX:** Prefer commands that work in the background (using `vscode.window.withProgress`) unless complex interaction is needed.
3. **Marketplace Integrity:** Maintain a clean `.vscodeignore`. Ensure `src/`, `test/`, and `DOGFOODING.md` are never packaged into the VSIX.
4. **No Telemetry:** The extension is local-first. No external analytics or data collection.
5. **Types First:** Always update `src/types.ts` before implementing new config-heavy features.

---

## 5. Current Implementation Progress
- [x] 3-Layer Provider Architecture.
- [x] Secure Config & Import/Export.
- [x] Marker-based Agent Sync & Rollback.
- [x] One-click commands (Selected Text, Clipboard, Editor Insert).
- [x] Full health-check and redaction logic.
- [x] 5/5 Passing Unit Tests.
- [x] Marketplace metadata (LICENSE, CHANGELOG, Repository).

---

## 6. Future Roadmap (The "Next" Big Things)
1. **MCP Server:** Exposing ContextForge capabilities as a Model Context Protocol server.
2. **Semantic Indexing:** Moving beyond simple file-scans to vector-based/symbol-graph context.
3. **Git-Awareness:** Including recent git diffs in the refinement context.
4. **Interactive Question UI:** Better handling of LLM clarification questions in the webview.

---
**When editing:** Refer to `DOGFOODING.md` for manual verification steps after any major change.
