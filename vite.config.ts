import { defineConfig } from 'vite';

export default defineConfig({
  // Baked in so the entry screen can print a copy-pasteable MCP config with a
  // real absolute path instead of a placeholder the player has to guess at.
  define: {
    __REPO_PATH__: JSON.stringify(process.cwd()),
  },
  // host: true binds 0.0.0.0 so anyone on the LAN can load the game.
  server: { port: 5173, open: false, host: true },
  preview: { port: 5173, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
