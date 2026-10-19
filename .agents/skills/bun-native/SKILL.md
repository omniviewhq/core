---
name: bun-native
description: Bun-first выбор API и зависимостей. Use before adding any dependency, choosing a library/client, or when jest, vitest, puppeteer, playwright, ioredis, pg, express, ws, axios, dotenv, execa, glob, uuid, bcrypt, yaml, sharp, node-cron, commander, chalk or similar come up. Also "нужна либа", "поставь пакет", "какой клиент взять".
---

# Bun-first

Порядок жёсткий:
1. Есть в Bun → берём Bun. Сторонний пакет запрещён (Biome `noRestrictedImports` ловит основные).
2. Нет в Bun, есть в `node:*` → берём `node:*`.
3. Нет нигде → **спросить пользователя**. Предложить 2–3 кандидата + вариант «написать самому», по строке: плюс, минус, мейнтенанс. Молча не ставить никогда.

Сомневаешься, есть ли в Bun → проверь https://bun.com/docs/llms.txt, не по памяти.

| Вместо | Bun |
|---|---|
| jest, vitest, mocha | `bun:test` (моки, снапшоты, coverage) |
| puppeteer, playwright | `Bun.WebView` |
| ioredis, node-redis | `Bun.redis`, `RedisClient` |
| pg, postgres.js, mysql2 | `Bun.sql` / `SQL` |
| better-sqlite3 | `bun:sqlite` |
| @aws-sdk/client-s3 | `Bun.s3`, `S3Client` |
| express, fastify, koa | `Bun.serve` (routes, static, HTML imports) |
| ws, socket.io (сервер) | `Bun.serve({ websocket })`, глобальный `WebSocket` |
| axios, node-fetch, got | `fetch` |
| dotenv | Bun грузит `.env` сам |
| execa, shelljs | `Bun.$`, `Bun.spawn` |
| glob, fast-glob, minimatch | `Bun.Glob` |
| semver | `Bun.semver` |
| bcrypt, argon2 | `Bun.password` |
| crypto-хэши, xxhash | `Bun.hash`, `Bun.CryptoHasher` |
| uuid | `crypto.randomUUID()`, `Bun.randomUUIDv7()` |
| js-yaml, yaml | `Bun.YAML`, импорт `.yaml` |
| toml, @iarna/toml | импорт `.toml`, `Bun.TOML` |
| marked, markdown-it | `Bun.markdown` (unstable) |
| sharp | `Bun.Image` |
| tar, archiver (tar) | `Bun.Archive` |
| node-cron | `Bun.cron` |
| cookie, csrf-пакеты | `Bun.Cookie` / `CookieMap`, `Bun.CSRF` |
| keytar | `Bun.secrets` |
| chalk, kleur | `Bun.color`, `util.styleText` |
| esbuild, webpack, vite (сборка) | `Bun.build`, `bun build --compile` |
| tsx, ts-node, nodemon | `bun`, `bun --watch` |
| fs-extra, readFile/writeFile | `Bun.file`, `Bun.write` |
| html-парсеры для трансформаций | `HTMLRewriter` |
| deep-equal, lodash.isequal | `Bun.deepEquals` |

JSON5, JSONL, XML, TCP/UDP, DNS, Workers, FFI — тоже встроены, см. docs перед выбором пакета.
