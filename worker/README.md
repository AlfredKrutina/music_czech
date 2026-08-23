# Cloudflare Worker Proxy

Tento adresář obsahuje kód pro Cloudflare Worker (`cors-proxy.js`), který slouží jako backend proxy pro:
1. Získávání playlistů z Apple Music (obchází CORS).
2. Spolehlivé vyhledávání videí na YouTube (obchází zablokovaná veřejná API a limity).

## Rychlý přístup (Editace Workeru)
Když potřebuješ rychle upravit kód workeru přímo v Cloudflare, použij tento odkaz:
[Upravit music-proxy v Cloudflare](https://dash.cloudflare.com/51fa66db414818ac5ec7bebfa94bb4fc/workers/services/edit/music-proxy/production)

## Jak updatovat
Kdykoliv změníš kód v `cors-proxy.js` tady na disku, musíš ho ručně zkopírovat a vložit na odkaz výše a kliknout na **Deploy**.
