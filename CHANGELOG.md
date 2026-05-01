# Changelog

All notable changes to ContextForge will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-05-02

### Added
- **Prompt Refinement:** Transforms rough ideas into structured, AI-agent-ready prompts.
- **Workspace Context:** Automatically scans workspace structure, `package.json`, and key files to enrich prompts with real project context.
- **SearXNG Integration:** Queries a local SearXNG instance to fetch up-to-date documentation and prevent AI hallucinations.
- **3-Layer Provider Architecture:**
  - **Native Adapters:** Built-in support for Gemini and Anthropic (Claude).
  - **OpenAI-Compatible Mode:** Supports Groq, DeepSeek, OpenRouter, LiteLLM, and any `/chat/completions`-compatible API. Includes Groq and OpenAI preset buttons.
  - **Generic HTTP Provider:** Full template-based adapter for non-standard APIs using `{{variable}}` templates and dot-notation `responseTextPath` extraction.
- **Health Check ("Test & Save"):** Validates API connectivity before saving any provider configuration.
- **Provider Config UI:** Dedicated webview panel for configuring providers with live feedback.
- **Provider Import/Export:** Export non-secret provider configuration and import it into other workspaces.
- **Agent Synchronization:** Safely injects refined prompts into AI agent instruction files using `<!-- contextforge:start/end -->` markers:
  - `AGENTS.md` (Codex)
  - `CLAUDE.md` (Claude Code)
  - `GEMINI.md` (Gemini)
  - `.github/copilot-instructions.md` (GitHub Copilot)
  - `.cursor/rules/contextforge.mdc` (Cursor)
  - `.continue/rules/contextforge.md` (Continue)
  - `.agents/rules/contextforge.md` (Antigravity)
- **Preview Sync:** Review planned file changes before writing.
- **Backup & Rollback:** Automatic `.contextforge.backup` files created before any write. Rollback via `ContextForge: Rollback Last Agent Sync`.
- **Actionable Error UI:** All errors surface with specific recovery instructions instead of raw stack traces.
- **Real-time Progress Tracking:** Animated step-by-step progress display during pipeline execution.
- **Sensitive Data Redaction:** API keys, Bearer tokens, `x-api-key` headers, and URL key params are automatically redacted from all diagnostic output.
- **Secure Key Storage:** All API keys stored exclusively in VS Code `SecretStorage`. Never written to disk.
- **Workspace-level Provider Config:** `.contextforge/providers.json` stores non-secret config. `.contextforge/providers.example.json` auto-generated as a shareable template.

### Security
- Strict Content Security Policy (CSP) nonce implemented in all webview panels.
- No telemetry or external tracking.
