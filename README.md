# Micheal — Trading Assistant

Jarvis-style trading companion named **Micheal**.

| Piece | Where | Job |
| --- | --- | --- |
| **Desktop** (`apps/desktop`) | Your PC | Sci-fi HUD, mic, speakers, session controls |
| **Cloud brain** (`apps/server`) | Germany VPS | Personality, focus coaching, memory, optional LLM |
| **Protocol** (`packages/protocol`) | Shared | WebSocket / REST message types |

Repo: [radiarkazemi/Micheal_LOQ](https://github.com/radiarkazemi/Micheal_LOQ)

## Quick start (local)

```bash
pnpm install
pnpm --filter @micheal/protocol build
MICHEAL_TOKEN=dev-token-change-me pnpm --filter @micheal/server dev
# other terminal
VITE_MICHEAL_URL=http://127.0.0.1:8787 VITE_MICHEAL_TOKEN=dev-token-change-me pnpm --filter @micheal/desktop dev
```

Open http://127.0.0.1:5174 (Chrome/Edge for voice).

## Production shape

```
PC ──WebSocket──► Germany server :8787  (/v1/ws)
                  heuristic brain (default)
                  + optional OPENAI_API_KEY for full Jarvis chat
```

Deploy helper: `deploy/install-server.sh` (run on the VPS as root).

## Security

- Never commit `MICHEAL_TOKEN`, API keys, or VPS passwords.
- Desktop sends the token on WebSocket hello.
- Rotate any password that was shared in chat; prefer SSH keys.

## License

MIT
