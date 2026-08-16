import { RELAY_PORT, EDGE_RELAY, resolveRelay } from '../net/protocol';

/**
 * Fills the entry screen's share/MCP blocks with values that are actually
 * correct for THIS machine.
 *
 * The host comes from `location.hostname`, which is whatever address the player
 * actually loaded the page from — so if they opened it via a LAN IP, the link
 * and the relay URL they hand to a friend or an agent are already the LAN ones,
 * with nothing to configure. The repo path is baked in by vite.config.ts.
 */
/**
 * Host a world at the edge, or join one by code.
 *
 * A world code is the whole invitation — no accounts, no lobby list. The code
 * routes to one Durable Object, which Cloudflare places near whoever created
 * it, so the world really does spin up next to its host and everyone else
 * connects to that instance.
 */
async function setupWorlds(): Promise<void> {
  const resolved = resolveRelay();
  const box = document.getElementById('worldBox');
  const codeEl = document.getElementById('worldCode');
  const hostBtn = document.getElementById('hostWorld');
  const joinBtn = document.getElementById('joinWorld');
  const joinInput = document.getElementById('joinCode') as HTMLInputElement | null;
  const statusEl = document.getElementById('worldStatus');
  if (!box || !codeEl || !hostBtn || !joinBtn || !joinInput || !statusEl) return;

  const shareUrl = (code: string) => {
    const u = new URL(location.href);
    u.searchParams.set('w', code);
    u.searchParams.delete('relay');
    return u.toString();
  };

  if (resolved.hosted && resolved.code) {
    codeEl.textContent = resolved.code;
    statusEl.textContent = 'You are joining a hosted world. Share the link and others land in it.';
    box.classList.add('joined');
    const a = document.createElement('a');
    a.href = shareUrl(resolved.code);
    a.textContent = shareUrl(resolved.code);
    a.className = 'worldLink';
    statusEl.appendChild(document.createElement('br'));
    statusEl.appendChild(a);
  } else {
    statusEl.textContent = 'Playing on this machine. Host a world to invite people anywhere.';
  }

  hostBtn.addEventListener('click', async () => {
    statusEl.textContent = 'Asking the edge for a world code…';
    try {
      const res = await fetch(`${EDGE_RELAY}/new`, { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      const { code } = (await res.json()) as { code: string };
      location.href = shareUrl(code);
    } catch {
      // The public relay is optional — self-hosting must never depend on it.
      statusEl.textContent =
        'No hosted relay is deployed at that address yet. See DEPLOY.md to put one up ' +
        'on the free tier in about two minutes, or keep playing locally with npm run play.';
    }
  });

  joinBtn.addEventListener('click', () => {
    const code = joinInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) { statusEl.textContent = 'Type the code someone gave you.'; return; }
    location.href = shareUrl(code);
  });
  joinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); joinBtn.dispatchEvent(new MouseEvent('click')); }
  });
}

export function setupGate(): void {
  void setupWorlds();
  const host = location.hostname || 'localhost';
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  const gameUrl = `${location.protocol}//${host}:${location.port || '5173'}/`;
  const relay = `ws://${host}:${RELAY_PORT}`;

  const lan = document.getElementById('lanLink') as HTMLAnchorElement | null;
  if (lan) {
    lan.textContent = gameUrl;
    lan.href = gameUrl;
    if (isLocal) {
      // Loading over localhost tells us nothing about the LAN address, and
      // handing someone "localhost" is the single most common way this fails.
      const note = document.createElement('div');
      note.className = 'note';
      note.style.marginTop = '6px';
      note.textContent =
        'You opened this over localhost, so this link only works on this machine. ' +
        'Run `npm run play` — the relay prints your LAN address — then reload the ' +
        'game from that address and this link will be the shareable one.';
      lan.parentElement?.appendChild(note);
    }
  }

  const cfg = {
    mcpServers: {
      philosoraptors: {
        command: 'node',
        args: [`${__REPO_PATH__}/mcp/server.mjs`],
        ...(isLocal ? {} : { env: { PHILO_RELAY: relay } }),
      },
    },
  };
  const pre = document.getElementById('mcpCfg');
  if (pre) pre.textContent = JSON.stringify(cfg, null, 2);

  const ru = document.getElementById('relayUrl');
  if (ru) ru.textContent = relay;

  const copy = (btn: HTMLElement | null, text: () => string) => {
    if (!btn) return;
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text());
        const old = btn.textContent;
        btn.textContent = 'copied';
        setTimeout(() => { btn.textContent = old; }, 1400);
      } catch {
        btn.textContent = 'press ctrl+C';
      }
    });
  };
  copy(document.getElementById('copyLan'), () => gameUrl);
  copy(document.getElementById('copyMcp'), () => JSON.stringify(cfg, null, 2));
}
