import { readFileSync } from "fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Versão do app injetada no bundle, usada no handshake do socket para o
// servidor bloquear clientes de versão diferente.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url)));

// CSP aplicada SÓ no build de produção (SG-11). No dev o @vitejs/plugin-react
// injeta um <script> inline (preâmbulo do Fast Refresh) que um script-src 'self'
// bloquearia; por isso a CSP não fica no index.html estático nem no dev server.
// img-src/media-src incluem http: porque os anexos do chat são servidos pelo
// servidor LAN em HTTP (mesma razão do connect-src). A página roda em file://,
// então não há bloqueio de mixed-content.
const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: https: http:; media-src 'self' data: https: http:; " +
  "font-src 'self' data:; " +
  "connect-src 'self' http: https: ws: wss:; object-src 'none'; " +
  "base-uri 'none'; frame-ancestors 'none'";

function cspPlugin() {
  return {
    name: "spotgino-csp",
    apply: "build",
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: {
            "http-equiv": "Content-Security-Policy",
            content: CONTENT_SECURITY_POLICY
          },
          injectTo: "head-prepend"
        }
      ];
    }
  };
}

export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  plugins: [react(), cspPlugin()],
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Sem polyfill de modulepreload: evita <script> inline no build, mantendo a
    // CSP com script-src 'self' (SG-11). Electron/Chromium suporta nativamente.
    modulePreload: { polyfill: false }
  }
});
