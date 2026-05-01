# ContextForge

ContextForge is a VS Code extension that transforms your rough, informal ideas into highly structured, context-rich prompts designed specifically for AI Coding Agents.

It intelligently scans your workspace, queries the web via a local search engine (SearXNG) to find up-to-date documentation, and utilizes an LLM (Groq or Gemini) to craft the perfect "system prompt." It then automatically injects this prompt into the instruction files used by your favorite AI assistants.

---

## 🚀 Features

- **Prompt Refinement:** Converts basic user intents (e.g., "build me a login page") into structured, developer-grade tasks.
- **Workspace Context:** Automatically injects directory structures, package files, and key application metadata into the prompt.
- **Live Search (SearXNG):** Fetches the latest API docs and tutorials to prevent AI hallucinations.
- **Agent Synchronization:** Securely injects the refined prompt into local AI agent files (Cursor, Copilot, Claude Code, etc.).
- **Safe Rollbacks:** Creates automatic backups and supports instant rollbacks if you don't like the newly synced instructions.

---

## 🛠️ Setup Guide

### 1. Configure the LLM Provider
ContextForge requires an API key for either Groq or Gemini to perform the refinement.

*   **Groq:** Fast, open-source model inference.
    *   Get an API key from [console.groq.com](https://console.groq.com).
*   **Gemini:** Google's multimodal AI.
    *   Get an API key from Google AI Studio.

**To configure:**
1. Open the VS Code Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Run `ContextForge: Configure Provider`.
3. Select your provider and enter the API key securely.

### 2. Configure SearXNG (Local Search)
ContextForge uses SearXNG to look up current documentation without tracking you.

**No Docker Required:**
You do *not* have to use Docker. You can install SearXNG via python packages or any method you prefer.
The only requirement is that the SearXNG instance must support JSON output format.

**To verify your SearXNG setup:**
Visit your local instance in a browser:
\`http://localhost:8080/search?q=test&format=json\`
If it returns a valid JSON response, it is configured correctly!

**To configure in ContextForge:**
1. Open VS Code Settings.
2. Search for `ContextForge SearXNG Base URL`.
3. Enter your URL (default: `http://localhost:8080`).

---

## 🤖 Supported Agents

ContextForge syncs context to the following agent tools without overwriting your manual rules. It uses `<!-- contextforge:start/end -->` markers to safely inject the context.

- **Codex / General:** `AGENTS.md`
- **Claude Code:** `CLAUDE.md`
- **Gemini:** `GEMINI.md`
- **GitHub Copilot:** `.github/copilot-instructions.md`
- **Cursor:** `.cursor/rules/contextforge.mdc`
- **Continue:** `.continue/rules/contextforge.md`
- **Google Antigravity:** `.agents/rules/contextforge.md`

*(Note: Kilo Code is intentionally skipped to prevent JSON config corruption).*

---

## 🛡️ Privacy & Security

We believe in maximum privacy:
- **No Telemetry:** We do not track your usage.
- **Secure Key Storage:** API keys are stored in VS Code's encrypted `SecretStorage`, never in plain text configuration files.
- **Local First:** Workspace paths and SearXNG queries never leave your machine (unless sent to your chosen LLM provider).
- **Diagnostics Redaction:** If an error occurs, copying the diagnostics will automatically redact (`***REDACTED***`) any sensitive API keys or tokens.

---

## ⏪ Backup & Rollback

ContextForge uses a **Non-Destructive Sync** mechanism.
Before writing to any existing file, it creates a backup (e.g., `AGENTS.md.contextforge.backup`).

If you wish to undo a sync:
1. Open the Command Palette.
2. Run `ContextForge: Rollback Last Agent Sync`.
3. Your original files will be instantly restored.

---

## ⚠️ Known Limitations
- The extension currently parses the first level of directories to respect token limits.
- **TODO for Publishers:** *This package uses a placeholder publisher ID (`contextforge-team`). Before publishing to the public VS Code Marketplace, this must be replaced with the officially registered publisher ID.*

---

**Built with ❤️ for Agentic Development.**
