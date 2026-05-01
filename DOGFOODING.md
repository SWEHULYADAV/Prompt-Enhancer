# ContextForge — Dogfooding Checklist

Use this checklist every time before publishing a new version or after a major change.
Install the VSIX first: `code --install-extension contextforge-0.1.0.vsix --force`
Then open a **separate test workspace** (not the ContextForge source directory).

---

## 1. Provider Setup

### 1A. Gemini Native Provider
- [ ] Run `ContextForge: Configure Provider`
- [ ] Select **Native Built-in** → **Gemini**
- [ ] Enter a valid Gemini API key
- [ ] Click **Test & Save** → should show "API is working"
- [ ] Config saved to `.contextforge/providers.json` (no key visible)
- [ ] Key exists in SecretStorage (test by closing and reopening VS Code)

### 1B. Anthropic / Claude Native Provider
- [ ] Run `ContextForge: Configure Provider`
- [ ] Select **Native Built-in** → **Anthropic (Claude)**
- [ ] Enter a valid Anthropic API key
- [ ] Click **Test & Save** → should show "API is working"

### 1C. Groq via OpenAI-Compatible Preset
- [ ] Run `ContextForge: Configure Provider`
- [ ] Select **OpenAI-Compatible**
- [ ] Click the **Groq Preset** button — fields should auto-fill
- [ ] Enter Groq API key
- [ ] Click **Test & Save** → should show "API is working"

### 1D. Custom OpenAI-Compatible Provider (manual config)
- [ ] Run `ContextForge: Configure Provider`
- [ ] Select **OpenAI-Compatible**
- [ ] Manually enter a base URL (e.g., a local LiteLLM server)
- [ ] Set correct model name
- [ ] Click **Test & Save** → verify response

### 1E. Generic HTTP Provider
- [ ] Run `ContextForge: Configure Provider`
- [ ] Select **Generic HTTP**
- [ ] Fill in URL, headers template, body template
- [ ] Set `responseTextPath` (e.g., `choices.0.message.content`)
- [ ] Click **Test & Save** → should show "API is working"

---

## 2. Error State Testing

### 2A. Wrong API Key
- [ ] Set an intentionally wrong API key for any provider
- [ ] Click **Test & Save** → should show `invalid_key` error, not a raw stack trace
- [ ] "Force Save Anyway" option should appear with a warning

### 2B. Wrong Model Name
- [ ] Set an invalid model name (e.g., `gpt-99999`)
- [ ] Click **Test & Save** → should show `invalid_model` error

### 2C. Wrong Base URL
- [ ] Set a non-existent base URL (e.g., `https://this-does-not-exist.example.com`)
- [ ] Click **Test & Save** → should show `invalid_url` error

### 2D. Wrong responseTextPath (Generic HTTP only)
- [ ] Set an incorrect `responseTextPath` (e.g., `nonexistent.path.here`)
- [ ] Click **Test & Save** → should show `invalid_response_path` error with the actual response snippet

### 2E. SearXNG Offline
- [ ] Stop or configure a bad SearXNG URL
- [ ] Try to refine a prompt → webview should show actionable SearXNG error with instructions

### 2F. SearXNG JSON Disabled
- [ ] Point to a SearXNG instance with JSON format disabled
- [ ] Try to refine a prompt → should show specific "Enable JSON format" instructions, not a generic error

---

## 3. Core Prompt Refinement Flow

- [ ] Open `ContextForge: Open Prompt Refiner`
- [ ] Type a rough prompt: `"build me a login page"`
- [ ] Click **Refine Prompt**
- [ ] Progress steps animate correctly (Provider → SearXNG → Workspace → etc.)
- [ ] Refined prompt appears in the output area
- [ ] **Copy Result** button copies to clipboard

---

## 4. Agent Synchronization

### 4A. Preview Sync
- [ ] After refining a prompt, click **Preview Sync**
- [ ] A list of files that would be written should appear — no files actually written yet
- [ ] Verify paths shown are correct for the current workspace

### 4B. Confirm Sync
- [ ] Click **Confirm Sync**
- [ ] Check `AGENTS.md` → contextforge markers should appear
- [ ] Check `.cursor/rules/contextforge.mdc` if applicable
- [ ] Check `.agents/rules/contextforge.md` if applicable
- [ ] User content **outside** markers must be unchanged

### 4C. Marker Isolation
- [ ] Add custom text above and below contextforge markers in `AGENTS.md`
- [ ] Run Confirm Sync again
- [ ] Verify custom text is fully preserved; only content inside markers updated

### 4D. Rollback
- [ ] Run `ContextForge: Rollback Last Agent Sync`
- [ ] Verify agent files restored to their pre-sync state
- [ ] `.contextforge.backup` files should be cleaned up or retained as expected

---

## 5. Provider Import / Export

- [ ] Run `ContextForge: Export Provider Config`
- [ ] Verify the exported JSON contains NO API keys
- [ ] Copy the JSON
- [ ] Run `ContextForge: Import Provider Config` and paste
- [ ] Verify config is loaded correctly

---

## 6. Security Audit

- [ ] Open VS Code Output panel during a failed request
- [ ] Confirm no API keys, Bearer tokens, or `x-api-key` values appear in logs
- [ ] Copy diagnostics from error panel → confirm `***REDACTED***` replaces any sensitive values
- [ ] Open `.contextforge/providers.json` → confirm no API keys present

---

## 7. Final Package Check

```bash
npm run compile     # 0 errors
npm run lint        # 0 errors (warnings acceptable for API payload field names)
npm test            # all tests pass
npm run package     # VSIX generated
```

Verify VSIX contents:
- [ ] No `src/` directory
- [ ] No `test/` directory
- [ ] No `*.map` source maps
- [ ] No `*.backup` files
- [ ] No `.contextforge/` runtime data
- [ ] No API keys or secrets
- [ ] Only: `out/*.js`, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, `resources/`
