export function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function escapeHtml(unsafe: string): string {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

export function redactSensitiveData(text: string): string {
    if (!text) { return text; }
    let redacted = text;
    // Redact Groq API Keys (gsk_...)
    redacted = redacted.replace(/gsk_[a-zA-Z0-9]{30,}/g, 'gsk_***REDACTED***');
    // Redact Gemini API Keys (AIza...)
    redacted = redacted.replace(/AIza[0-9A-Za-z-_]{35}/g, 'AIza***REDACTED***');
    // Redact Anthropic API Keys (sk-ant-...)
    redacted = redacted.replace(/sk-ant-[a-zA-Z0-9_-]{50,}/g, 'sk-ant-***REDACTED***');
    // Redact OpenAI API Keys (sk-...)
    redacted = redacted.replace(/sk-[a-zA-Z0-9]{40,}/g, 'sk-***REDACTED***');
    // Redact Bearer tokens
    redacted = redacted.replace(/Bearer\s+[a-zA-Z0-9\-\._~\+\/]+/gi, 'Bearer ***REDACTED***');
    // General x-api-key Redaction
    redacted = redacted.replace(/x-api-key:\s*[a-zA-Z0-9\-\._~\+\/]+/gi, 'x-api-key: ***REDACTED***');
    // Redact URL query parameters for keys
    redacted = redacted.replace(/([?&](?:key|api[_-]?key|token)=)[a-zA-Z0-9\-\._~\+\/]+/gi, '$1***REDACTED***');
    // Redact private keys
    redacted = redacted.replace(/-----BEGIN PRIVATE KEY-----(?:.|[\r\n])+?-----END PRIVATE KEY-----/g, '-----BEGIN PRIVATE KEY-----\n***REDACTED***\n-----END PRIVATE KEY-----');
    return redacted;
}

export function mapErrorToUiError(error: any): import('./types').ContextForgeUiError {
    const message = error?.message || String(error);
    const details = error?.stack ? String(error.stack) : undefined;
    
    // Missing API Key
    if (message.includes('API Key is missing') || message.includes('API Key is not configured')) {
        return {
            code: 'PROVIDER_MISSING_KEY',
            title: 'API Key Missing',
            message: message,
            severity: 'error',
            source: 'provider',
            actionable: true,
            actions: [{ id: 'configureProvider', label: 'Configure Provider' }],
            details
        };
    }

    // SearXNG Disabled JSON / 403 / Invalid JSON
    if (message.includes('JSON output is not enabled') || message.includes('search.formats')) {
        return {
            code: 'SEARXNG_JSON_DISABLED',
            title: 'SearXNG JSON Disabled',
            message: 'Your SearXNG instance does not have the JSON format enabled. Please edit your SearXNG settings.yml and add "json" to the "search.formats" list.',
            severity: 'error',
            source: 'searxng',
            actionable: true,
            actions: [
                { id: 'retry', label: 'Retry' },
                { id: 'configureSearxng', label: 'Configure URL' }
            ],
            details
        };
    }

    if (message.includes('Search unavailable') || message.includes('connect to SearXNG')) {
        return {
            code: 'SEARXNG_OFFLINE',
            title: 'SearXNG Unreachable',
            message: 'Failed to connect to the SearXNG instance. Is it running?',
            severity: 'warning',
            source: 'searxng',
            actionable: true,
            actions: [
                { id: 'retry', label: 'Retry' },
                { id: 'configureSearxng', label: 'Configure URL' }
            ],
            details
        };
    }

    if (message.includes('rate limit') || message.includes('429')) {
        return {
            code: 'PROVIDER_RATE_LIMIT',
            title: 'Rate Limit Reached',
            message: 'The LLM provider rate limit has been reached. Please wait a moment and try again.',
            severity: 'warning',
            source: 'provider',
            actionable: true,
            actions: [{ id: 'retry', label: 'Retry' }],
            details
        };
    }

    return {
        code: 'UNKNOWN_ERROR',
        title: 'Unexpected Error',
        message: message || 'An unexpected error occurred during the pipeline execution.',
        severity: 'error',
        source: 'unknown',
        actionable: true,
        actions: [{ id: 'retry', label: 'Retry' }],
        details
    };
}
