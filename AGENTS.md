# AGENTS.md

## Overview & Architecture

- **Project Type**: Node.js ES Modules (`"type": "module"` in `package.json`). Express backend + Baileys WhatsApp integration + SISCAN (Ministério da Saúde) web scraper.
- **Entry Point**: `server.js` initializes Express API (port 3000), Baileys WhatsApp socket (`iniciarWhatsApp()`), and a weekly scheduled cron job (`0 3 * * 1`).
- **Scraper Module**: `integracao.js` exports `automatizarBuscaAtiva()`, which uses `axios` with `tough-cookie` and `cheerio` to automate multi-step JSF/RichFaces login and report scraping on `https://siscan.saude.gov.br`.
- **Database**: Local JSON storage in `pacientes.json`. Patient personal fields (`nome`, `numero`, `nascimento`, `cpf`, `endereco`) are encrypted via AES-256-CBC before saving.
- **Frontend**: Static files in `public/` (`index.html`, `scripts/script.js`). Auth token stored in `sessionStorage` with 5-minute expiration monitoring.

## Commands

- `node server.js` — Start the Express API server and initialize the WhatsApp socket (displays terminal QR code if session is not authenticated).
- `node integracao.js` — Run standalone test execution of the SISCAN scraper (saves response HTML to `resultado_busca_ativa.html`).

## Operational Gotchas & Environment Rules

- **Environment File (`.env`)**:
  - `SECRET_KEY`: Must be a 64-character hex string (32 bytes) used for AES-256-CBC encryption (`crypto.createCipheriv`).
  - `SENHA_PAINEL`: Serves as both the login authentication password and the JWT signing secret (`expiresIn: '5m'`).
- **Data & Auth Credentials**:
  - `auth_info/`: Folder housing Baileys multi-file authentication state (`useMultiFileAuthState`). Do not delete unless re-authenticating WhatsApp via terminal QR code.
  - `pacientes.json`: Encrypted JSON database. Read/write operations must use `criptografar` and `descriptografar` functions from `server.js`.
- **SISCAN JSF Scraper (`integracao.js`)**:
  - Relies on strict JSF/RichFaces state tracking. Each AJAX call updates `javax.faces.ViewState` and requires specific headers (`X-Requested-With: XMLHttpRequest`, `Faces-Request: partial/ajax`).
  - Saves debug HTML snapshots on failure (`erro_login_real.html`, `erro_ajax_*.html`).
- **Phone Number Format & JID Logic**:
  - Numbers are formatted with country code `55`. `server.js` contains automatic DDD length correction for 13-digit numbers (`ddd > 31`).
