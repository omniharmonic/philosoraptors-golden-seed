import { RELAY_PORT } from '../net/protocol';

/**
 * Fills the entry screen's share/MCP blocks with values that are actually
 * correct for THIS machine.
 *
 * The host comes from `location.hostname`, which is whatever address the player
 * actually loaded the page from — so if they opened it via a LAN IP, the link
 * and the relay URL they hand to a friend or an agent are already the LAN ones,
 * with nothing to configure. The repo path is baked in by vite.config.ts.
 */
export function setupGate(): void {
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
