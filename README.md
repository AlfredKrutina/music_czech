# 🎵 Music Guess — Song Guessing Game

A **Heardle-style** music guessing game that plays short audio clips (0.5s → 16s) from your playlists. Built as a 100% frontend static app with a local proxy.

![Screenshot](https://img.shields.io/badge/status-ready-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue)

## 🚀 Quick Start

### 1. Clone or download this project

```bash
git clone <your-repo-url> music-guess
cd music-guess
```

### 2. Start a local HTTP server

**macOS / Linux:**
```bash
chmod +x start.sh
./start.sh
```

**Windows:**
```
start.bat
```

**Or manually:**
```bash
python3 -m http.server 8000
```

### 3. Open in your browser

Navigate to **http://localhost:8000**

> ⚠️ **Important:** The app must run via HTTP server (not `file://`). The YouTube IFrame API requires an HTTP origin.

---

## 🟢 Spotify Setup (one-time)

To load Spotify playlists, you need a **free** Spotify Developer Client ID:

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Log in with your Spotify account
3. Click **Create app**
4. Fill in:
   - **App name:** Music Guess (or anything)
   - **App description:** Song guessing game
   - **Redirect URIs:** `http://localhost:8000/callback.html`
5. Click **Save**
6. Copy the **Client ID** from the app settings
7. Paste it into the game's setup screen and click **Save**

> 💡 For GitHub Pages, also add your Pages URL as a redirect URI:
> `https://yourusername.github.io/your-repo/callback.html`

---

## 🎮 How to Play

1. **Load a Playlist** — Paste a Spotify, Apple Music, or YouTube Music playlist URL.
2. **Listen to the clip** — starts at just 500ms!
3. **Guess the song** — use the autocomplete to lock in your answer.
4. **Skip for more** — each skip extends the clip (0.5s → 1s → 2s → 4s → 8s → 16s)

### Scoring

| Attempt | Duration  | Points |
|---------|-----------|--------|
| 1st     | 0.5s      | 6      |
| 2nd     | 1.0s      | 5      |
| 3rd     | 2.0s      | 4      |
| 4th     | 4.0s      | 3      |
| 5th     | 8.0s      | 2      |
| 6th     | 16.0s     | 1      |
| Failed  | —         | 0      |

---

## 📋 Supported Playlist Formats

| Platform | URL Format | Auth Required? |
|----------|-----------|---------------|
| **Spotify** | `https://open.spotify.com/playlist/xxxxx` | Yes (Client ID) |
| **YouTube Music** | `https://music.youtube.com/playlist?list=xxxxx` | No |
| **YouTube** | `https://www.youtube.com/playlist?list=xxxxx` | No |

---

## 🏗 Architecture

```
100% Frontend — No Node.js, no backend, no API keys exposed
```

- **Authentication:** Spotify PKCE Authorization Code Flow (client-side only)
- **Track Search:** Invidious & Piped public APIs (no YouTube API key needed)
- **Audio Playback:** YouTube IFrame Player API (hidden player)
- **Timing:** `setTimeout` for precise clip duration control

### File Structure

```
├── index.html          Single-page app (5 screens)
├── callback.html       Spotify OAuth redirect handler
├── css/
│   └── style.css       Dark theme responsive styles
├── js/
│   ├── config.js       Constants & API endpoints
│   ├── fuzzy.js        Fuzzy string matching
│   ├── auth.js         Spotify PKCE auth flow
│   ├── search.js       YouTube search (Invidious/Piped)
│   ├── player.js       YouTube IFrame player wrapper
│   ├── playlist.js     URL parsing & track fetching
│   ├── game.js         Game state & scoring
│   ├── ui.js           DOM manipulation & autocomplete
│   └── app.js          Main orchestrator
├── start.bat           Windows launcher
├── start.sh            Mac/Linux launcher
└── README.md           This file
```

---

## 🔧 Troubleshooting

### "Popup blocked" error
Allow popups for `localhost:8000` in your browser settings.

### No audio playing
- Make sure you're running via HTTP server, not `file://`
- Some YouTube videos block embedded playback — the game will skip them automatically
- Check that your browser doesn't block third-party cookies

### Spotify authentication fails
- Verify your Client ID is correct
- Make sure `http://localhost:8000/callback.html` is listed as a Redirect URI in your Spotify app settings
- The Redirect URI must match **exactly** (including trailing slashes)

### YouTube search returns no results
The game uses public Invidious/Piped instances which may occasionally be down. The app automatically tries multiple instances, but if all fail, try again in a few minutes.

### Raspberry Pi
Works on Chromium on Raspberry Pi OS. Use the `start.sh` script:
```bash
chmod +x start.sh
./start.sh
```

---

## 📄 License

MIT — do whatever you want with it.
