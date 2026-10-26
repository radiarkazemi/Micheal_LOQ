# Micheal — Trading Assistant

Jarvis-style trading companion named **Micheal** (میشل). Speaks **Persian + English**. Cloud brain stays **always live** in Germany; PC/browser is the presence.

| Piece | Where | Job |
| --- | --- | --- |
| **Live HUD** | Browser → `http://91.107.171.162:8787/` | Always-on UI (bookmark / PWA) |
| **Desktop** (`apps/desktop`) | Windows Electron tray app | Always running in the corner; mirrors cloud HUD |
| **Cloud brain** (`apps/server`) | Germany VPS `:8787` | Persian/EN personality, focus, memory, optional LLM |
| **Protocol** (`packages/protocol`) | Shared | WebSocket / REST message types |

Repo: [radiarkazemi/Micheal_LOQ](https://github.com/radiarkazemi/Micheal_LOQ)

## Use it now

1. **Browser (fastest):** open  
   `http://91.107.171.162:8787/?token=YOUR_TOKEN`  
   or open the HUD and paste the token once (saved in the browser).
2. **Install page:** `http://91.107.171.162:8787/install.html`
3. **Windows app:** download from `/download/Micheal-Windows.zip` or `/download/Micheal-Setup.exe` on that same host, run it — tray icon stays live; closes to tray, not exit.

## Quick start (local)

```bash
pnpm install
pnpm --filter @micheal/protocol build
MICHEAL_TOKEN=dev-token-change-me pnpm --filter @micheal/server dev
# other terminal — browser HUD
VITE_MICHEAL_URL=http://127.0.0.1:8787 VITE_MICHEAL_TOKEN=dev-token-change-me pnpm --filter @micheal/desktop dev
# Electron shell
pnpm --filter @micheal/desktop dev:electron
```

## Deploy (VPS)

```bash
bash deploy/build-release.sh
# copy deploy/release to /opt/micheal/deploy/release on the VPS
bash deploy/install-server.sh
```

## Production shape

```
Windows / Browser ──WebSocket (keepalive)──► Germany :8787  (/v1/ws)
                                             heuristic FA/EN brain
                                             + optional OPENAI_API_KEY
                                             + static live HUD + downloads
```

## Security

- Never commit `MICHEAL_TOKEN`, API keys, or VPS passwords.
- Desktop/browser sends the token on WebSocket hello.
- Rotate any password that was shared in chat; prefer SSH keys.

## License

MIT
