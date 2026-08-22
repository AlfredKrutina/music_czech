/**
 * auth.js — Spotify PKCE Authorization Code Flow (100% frontend, no client_secret).
 *
 * Flow:
 * 1. Generate code_verifier (random 64 chars) + code_challenge (SHA-256 → Base64URL)
 * 2. Open popup → accounts.spotify.com/authorize with PKCE params
 * 3. callback.html extracts `code` and sends it via postMessage
 * 4. Exchange code for access_token via POST to /api/token
 * 5. Token stored in sessionStorage (cleared on tab close)
 */
const SpotifyAuth = {
    _token: null,
    _tokenExpiry: null,

    // ─── Crypto Helpers ──────────────────────────────────────────────

    _generateRandomString(length) {
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
        const values = crypto.getRandomValues(new Uint8Array(length));
        return Array.from(values, v => possible[v % possible.length]).join('');
    },

    async _sha256(plain) {
        const encoder = new TextEncoder();
        const data = encoder.encode(plain);
        return crypto.subtle.digest('SHA-256', data);
    },

    _base64urlencode(arrayBuffer) {
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (const b of bytes) binary += String.fromCharCode(b);
        return btoa(binary)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    },

    async _generateCodeChallenge(verifier) {
        const hashed = await this._sha256(verifier);
        return this._base64urlencode(hashed);
    },

    // ─── Client ID Management ────────────────────────────────────────

    getClientId() {
        return localStorage.getItem('spotify_client_id') || '';
    },

    setClientId(clientId) {
        localStorage.setItem('spotify_client_id', clientId.trim());
    },

    hasClientId() {
        return !!this.getClientId();
    },

    // ─── Redirect URI ────────────────────────────────────────────────

    getRedirectUri() {
        let path = window.location.pathname;
        if (path.endsWith('.html')) {
            path = path.replace(/\/[^/]*$/, '/');
        } else if (!path.endsWith('/')) {
            path += '/';
        }
        return window.location.origin + path + 'callback.html';
    },

    // ─── Token Management ────────────────────────────────────────────

    isAuthenticated() {
        const token = this.getToken();
        return !!token;
    },

    getToken() {
        // Check in-memory first
        if (this._token && this._tokenExpiry && Date.now() < this._tokenExpiry) {
            return this._token;
        }
        // Fall back to sessionStorage
        const saved = sessionStorage.getItem('spotify_token');
        const expiry = sessionStorage.getItem('spotify_token_expiry');
        if (saved && expiry && Date.now() < parseInt(expiry, 10)) {
            this._token = saved;
            this._tokenExpiry = parseInt(expiry, 10);
            return this._token;
        }
        return null;
    },

    _saveToken(accessToken, expiresIn) {
        this._token = accessToken;
        this._tokenExpiry = Date.now() + (expiresIn * 1000) - 60000; // 1 min safety margin
        sessionStorage.setItem('spotify_token', this._token);
        sessionStorage.setItem('spotify_token_expiry', this._tokenExpiry.toString());
    },

    logout() {
        this._token = null;
        this._tokenExpiry = null;
        sessionStorage.removeItem('spotify_token');
        sessionStorage.removeItem('spotify_token_expiry');
        sessionStorage.removeItem('spotify_code_verifier');
    },

    // ─── Authentication Flow ─────────────────────────────────────────

    async authenticate() {
        const clientId = this.getClientId();
        if (!clientId) {
            throw new Error('Spotify Client ID is not configured. Please enter it in the setup screen.');
        }

        const codeVerifier = this._generateRandomString(64);
        const codeChallenge = await this._generateCodeChallenge(codeVerifier);
        const state = this._generateRandomString(16);

        // Save verifier for the token exchange step
        sessionStorage.setItem('spotify_code_verifier', codeVerifier);
        sessionStorage.setItem('spotify_auth_state', state);

        const params = new URLSearchParams({
            client_id: clientId,
            response_type: 'code',
            redirect_uri: this.getRedirectUri(),
            scope: CONFIG.SPOTIFY.SCOPES,
            code_challenge_method: 'S256',
            code_challenge: codeChallenge,
            state: state,
            show_dialog: 'false'
        });

        const authUrl = `${CONFIG.SPOTIFY.AUTH_URL}?${params.toString()}`;

        return new Promise((resolve, reject) => {
            // Open auth popup
            const popup = window.open(
                authUrl,
                'SpotifyAuth',
                'width=500,height=700,menubar=no,toolbar=no,location=yes'
            );

            if (!popup || popup.closed) {
                reject(new Error('Popup blocked! Please allow popups for this site and try again.'));
                return;
            }

            // Listen for the callback message
            const handleMessage = async (event) => {
                if (event.origin !== window.location.origin) return;
                if (!event.data || event.data.type !== 'spotify-auth-callback') return;

                window.removeEventListener('message', handleMessage);
                clearInterval(pollClosed);

                if (event.data.error) {
                    reject(new Error(`Spotify authorization denied: ${event.data.error}`));
                    return;
                }

                if (!event.data.code) {
                    reject(new Error('No authorization code received from Spotify.'));
                    return;
                }

                // Verify state parameter
                const savedState = sessionStorage.getItem('spotify_auth_state');
                if (event.data.state && event.data.state !== savedState) {
                    reject(new Error('State mismatch — possible CSRF attack. Please try again.'));
                    return;
                }

                try {
                    await this._exchangeCode(event.data.code);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            };

            window.addEventListener('message', handleMessage);

            // Poll to detect if user closed the popup without completing auth
            const pollClosed = setInterval(() => {
                if (popup.closed) {
                    clearInterval(pollClosed);
                    window.removeEventListener('message', handleMessage);
                    if (!this.isAuthenticated()) {
                        reject(new Error('Authentication was cancelled.'));
                    }
                }
            }, 500);
        });
    },

    async _exchangeCode(code) {
        const clientId = this.getClientId();
        const codeVerifier = sessionStorage.getItem('spotify_code_verifier');

        if (!codeVerifier) {
            throw new Error('Missing code verifier. Please restart the authentication flow.');
        }

        const response = await fetch(CONFIG.SPOTIFY.TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: clientId,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: this.getRedirectUri(),
                code_verifier: codeVerifier
            })
        });

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            throw new Error(
                `Token exchange failed: ${errBody.error_description || errBody.error || response.statusText}`
            );
        }

        const data = await response.json();
        this._saveToken(data.access_token, data.expires_in);

        // Clean up
        sessionStorage.removeItem('spotify_code_verifier');
        sessionStorage.removeItem('spotify_auth_state');
    }
};
