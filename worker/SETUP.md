# Apple Music Proxy Setup — Cloudflare Worker

Apple Music blokuje přímé dotazy z prohlížeče (CORS policy). Pro zprovoznění
Apple Music playlistů je potřeba jednorázová 5minutová konfigurace.

## Proč je to potřeba?

Spotify a YouTube Music mají veřejné API přístupné z JavaScriptu. Apple Music nemá — 
jejich stránky blokují cross-origin requesty z bezpečnostních důvodů.

Řešením je **Cloudflare Worker** — mini-serverless funkce která běží v Cloudflare síti,
získá Apple Music stránku za tebe a pošle ji zpět s správnými CORS hlavičkami.

Cloudflare Worker je **zdarma** (100 000 requestů/den).

---

## Postup (5 minut)

### 1. Vytvoř Cloudflare účet

Jdi na [workers.cloudflare.com](https://workers.cloudflare.com) a vytvoř bezplatný účet.
Nepotřebuješ žádnou platební kartu pro free tier.

### 2. Vytvoř Worker

1. V dashboardu klikni **Workers & Pages → Create Worker**
2. Dej mu libovolný název (např. `music-proxy`)
3. Klikni **Deploy** (nejprve s výchozím kódem)

### 3. Vlož kód Worker

1. Klikni **Edit code**
2. Smaž veškerý výchozí kód
3. Zkopíruj a vlož **celý obsah** souboru [`worker/cors-proxy.js`](../worker/cors-proxy.js)
4. Klikni **Save & Deploy**

### 4. Zkopíruj URL Workeru

Po deployi uvidíš URL ve formátu:
```
https://music-proxy.tvoje-jmeno.workers.dev
```

### 5. Nastav URL v aplikaci

Otevři [`js/config.js`](../js/config.js) a vlož URL:

```js
APPLE_MUSIC_WORKER_URL: 'https://music-proxy.tvoje-jmeno.workers.dev',
```

### 6. Commitni a pushni

```bash
git add js/config.js
git commit -m "feat: add Apple Music proxy worker URL"
git push
```

**Hotovo!** Apple Music playlisty budou fungovat pro všechny uživatele aplikace.

---

## Jak to funguje

```
Prohlížeč → Cloudflare Worker → music.apple.com
              (váš worker)        (Apple Music)
```

Worker stáhne stránku Apple Music jako normální prohlížeč (obejde CORS),
přidá `Access-Control-Allow-Origin: *` hlavičku, a vrátí obsah zpět.

Apple Music nevidí rozdíl od normálního návštěvníka.

---

## Zabezpečení

Worker v `cors-proxy.js` whitelistuje pouze `music.apple.com` — nemohou přes něj
procházet jiné weby. Kód si můžeš prohlédnout v [`worker/cors-proxy.js`](../worker/cors-proxy.js).
