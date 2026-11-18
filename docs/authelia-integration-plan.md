# Authelia Integration Plan (SUBVerse)

**Status: PLAN ONLY — nothing here is implemented.** No container, config file, or line of application code in this repository has been changed as a result of this document.

| | |
|---|---|
| Scope | Add Authelia to the compose stack; make **accountant** the single source of truth for accounts and per-project repo access; integrate `accountant`, `subversion`, `git` (Forgejo), and later `lore` / Fortune Loom |
| Realises | README "Future Plans": *"Centralizing user accounts across all services … likely involving an open, self-hosted OAuth solution"* — this plan chooses **Authelia** over Authentik, and Forgejo over Gitea/GitLab CE |
| Verified against | Authelia docs at `master`, cross-checked to **v4.39.28**; **Forgejo v17.0.1** (v15 = LTS line); Traefik in this repo is pinned `traefik:v3.6` (`traefik/docker-compose.yaml:3`) while Authelia's Traefik guide is tested on **v3.7.13 / v2.11.57** |
| Date | 2026-11-16 |

---

## 1. Goal and non-goals

**Goal.** One identity per human, created once in accountant, that works everywhere; one place to change a password; one place to grant/revoke project access; MFA where it is actually usable.

**Non-goals (explicitly given up, see §3).**
- MFA for `svn` / `git` command-line clients — impossible through Authelia (§3, "Basic is always 1FA").
- Single logout across the stack — Authelia publishes no logout propagation.
- Per-repository rules inside Authelia — its ACLs are static config and coarse by design.

---

## 2. Constraints that shape everything (all verified)

### 2.1 Authelia side

| Fact | Consequence for SUBVerse |
|---|---|
| **No user-provisioning API.** `api/openapi.yml` is self-service only (`/api/state`, `/api/verify`, `/api/user/info`, `/api/change-password`, `/api/reset-password/*`, `/api/secondfactor/*`, `/api/oidc/*`). Admin dashboard + "User Management (create/modify/delete)" is a roadmap item at *design stage*, implementation "not started" ([roadmap](https://www.authelia.com/roadmap/active/dashboard-control-panel-and-cli-for-admins/)) | accountant must feed Authelia by **file or LDAP**, never by REST. `external_identity` is not a user provider — "Authelia never creates users from an external provider" |
| File backend: YAML/TOML/JSON, `authentication_backend.file.watch: true` hot-reloads the user DB; hash `password.algorithm` ∈ argon2 \| scrypt \| pbkdf2 \| sha2crypt \| **bcrypt**; record fields `disabled`, `displayname`, `password`, `email`, `groups` ([docs](https://www.authelia.com/configuration/first-factor/file/)) | accountant can keep writing credentials, exactly as it already writes `/etc/subversion/passwd` |
| ⚠️ "Authelia writes this file back in the same format it reads it in, for example when a user resets their password" | **dual-writer clobbering** → set `authentication_backend.password_reset.disable: true` and `password_change.disable: true`; accountant stays the only writer |
| 2FA secrets, sessions, regulation logs, OIDC client/authorisation state live in **Authelia's own SQL DB**; `storage.encryption_key` is mandatory (min 20 chars, ≥64 recommended) ([docs](https://www.authelia.com/configuration/storage/sqlite/)) | MFA enrolment belongs to Authelia, keyed by username. SQLite is fine for one container but is stateful → back it up; losing `encryption_key` makes every TOTP/WebAuthn enrolment unreadable |
| LDAP backend supports `implementation: custom \| activedirectory \| rfc2307bis \| freeipa \| lldap \| glauth` ([docs](https://www.authelia.com/configuration/first-factor/ldap/)) | if a directory is ever adopted, **LLDAP** is the low-friction choice (GraphQL API, SQLite, scriptable) — but LLDAP has no attribute for "disabled", so Authelia's `users_filter` cannot exclude disabled accounts ([docs](https://www.authelia.com/integration/ldap/lldap/)) |
| At the authz endpoint, Basic credentials are checked by **Authelia**, per request; `scheme_basic_cache_lifespan` defaults to `0` (no caching) ([docs](https://www.authelia.com/reference/guides/proxy-authorization/)) | chatty WebDAV would hit Argon2/LDAP on every request → either cache, or keep Apache authenticating |
| **Basic authentication is always `one_factor`** — `handleGetBasic()` returns `authentication.OneFactor` unconditionally (`internal/handlers/handler_authz_authn.go`) | a `two_factor` rule can never be satisfied by `svn`/`git` CLI. Basic failure ⇒ `401 + WWW-Authenticate` (CLI-friendly); cookie-session failure ⇒ `302` to the portal (**breaks CLI**) |
| Legacy `/api/verify` is deprecated (4.38+) and its `HeaderLegacy` strategy reads `Authorization` only with `?auth=basic`. Bearer `authelia_at_…` tokens need ≥ v4.38, scope `authelia.bearer.authz`, explicit audience, and a client that can set headers | neither helps SVN/git clients; use them only for server-to-server calls |
| Config hot-reload (`X_AUTHELIA_CONFIG_RELOAD*`, SIGHUP reload) exists on **master / v4.40 only**; on 4.39 SIGHUP merely reopens log files | `access_control` edits require a container restart today → keep Authelia rules coarse and treat config as code (`authelia configuration check` before deploy) |
| `session.cookies[].domain` must be a real, CA-issuable name **containing a dot**, not a public suffix, not `localhost`, and a suffix of `authelia_url` | **`BASE_DOMAIN=subverse` is invalid for Authelia.** A domain decision (`subverse.lan`, `subverse.dev`, …) + internal DNS + a CA your clients trust is a hard prerequisite. IP-address and `:port` hosts are impossible |
| `authentication_backend.refresh_interval` (default `5m`; `always` for file) governs how fast a deleted/disabled user drops out; the session is destroyed when the user vanishes from the backend | revocation latency is minutes, not instant — account for it in the access-revocation story |
| `ntp.disable_startup_check` exists but Authelia **refuses to start** if NTP is unreachable/skewed (>3 s desync) | Synology pitfall: verify NAS time sync (UDP 123) before first deploy |
| Regulation bans are **global per identity** | a stale cached `svn` password retrying can lock a human out of *everything* → tune `regulation.*`, or keep Apache auth for SVN |
| No OIDC Front-Channel/Back-Channel logout, no session-management API, no DCR, no ROPC, no SAML; only `POST /api/logout` at the portal | an app-minted session (accountant JWT) **survives** Authelia logout — short TTLs or header mode are the mitigations |
| Docs contain zero mentions of gRPC, WebDAV, SVN, or Apache; the proxy list is Caddy/Envoy/HAProxy/NGINX/NPM/SWAG/Skipper/Traefik | httpd cannot natively consume forward-auth headers. Do **not** plan on "Apache trusts Authelia" |
| Redis/cache is unnecessary for a single container; `session.allow_private_bypass` does **not** exist in any version | LAN-only exceptions are done with `access_control.rules[].networks` + `policy: bypass` |

### 2.2 SUBVerse side (current state)

- **Traefik** (`traefik/traefik.yaml`): entrypoints `web` (:80 → redirect) and `websecure` (:443), `forwardedHeaders.trustedIPs: 172.19.0.1/24`, `exposedByDefault: false`, **no UDP entrypoint**; `transport.responding.idleConnTimeout: "10s"` must stay below Apache's `KeepAliveTimeout 65`. Default cert is hard-coded to `/certs/custom-chain.pem` + `/certs/privkey.pem`. No router on `svn`, `accountant`, or `lore-webgui` attaches any middleware today.
- **Subversion** (`subversion/config/apache2-gateway/conf.d/dav_svn.conf:17-32`): `AuthType Basic` + `AuthUserFile /etc/subversion/passwd` + `AuthzSVNAccessFile /etc/subversion/subversion-access-control` + `Require valid-user`. `mod_authn_file` and `mod_authz_svn` are loaded; **`mod_authnz_ldap` is not**. Header/destination rewrites (`:10-15`) exist to stop 502s — adding a hop without re-checking them risks regressing commits `93c6a1a` / `e2c3043`.
- **accountant**: HS256 JWT (`JWT_SECRET`, `JWT_TIMEOUT ?? '8h'`) in `localStorage['accountant_token']`; bcryptjs cost 10; its own login / bootstrap / verify-email / forgot-reset flows; role gates read `req.user.type` from the JWT; SVN credentials are pushed by dockerode `exec` into `svn_gateway`.
- **lore**: gRPC over a TCP `HostSNI` passthrough router plus a direct `41337` publish; the UDP router label (`lore/docker-compose.yaml:35`) references an undefined `lore-udp` entrypoint, so QUIC currently works only via the direct UDP publish. Only `lore-webgui` (`AUTH=accounts`, port 7337) is an HTTP surface.
- **Forgejo** (v17): org/team membership can only be added **through a team** — `PUT /orgs/{org}/members/{username}` does not exist; LDAP sources have **no group→team mapping**; OIDC sources do.

---

## 3. Target architecture: three planes, one writer

```
accountant (Prisma DB)   ── SYSTEM OF RECORD: people, roles, project membership
     │  single writer · idempotent reconcile (same pattern as rebuildAccessControlFile())
     ├──► Authelia users.yml            (authentication_backend.file, watch: true) → humans + groups
     ├──► /etc/subversion/passwd        (bcrypt)                 → svn CLI credentials      [unchanged]
     ├──► /etc/subversion/subversion-access-control               → svn path-level ACLs     [unchanged]
     └──► Forgejo admin API             (orgs, teams, members, repos)                      [new]

Authelia  = browser SSO + MFA + OIDC provider + COARSE policy at Traefik (host × group × factor)
Services  = FINE-grained authorization: accountant RBAC · mod_authz_svn · Forgejo orgs/teams
```

**Ownership contract**

| Concern | Owner | Notes |
|---|---|---|
| Account lifecycle (create/rename/disable/delete) | **accountant** | Authelia and Forgejo are downstream projections |
| Password hash | **accountant** (bcrypt, cost 10) | projected into `users.yml` + SVN `passwd`; Authelia-side reset/change disabled |
| MFA enrolment (TOTP/WebAuthn) | Authelia | in Authelia's own DB, keyed by username |
| Browser session | Authelia cookie | accountant keeps at most a short internal session |
| Coarse policy (host × group × factor) | Authelia `access_control` | static config, restart to change |
| Repo access | SVN authz file + Forgejo orgs/teams | derived from project assignments in the DB |
| Audit of logins/regulation | Authelia logs/DB | accountant keeps its own admin-action audit |

**Group naming convention** (derived mechanically from the DB):

```
all_users, admins, teachers, students          # roles
proj:{slug}                                    # e.g. proj:fa26-450-godot
proj:{slug}:{team}                             # e.g. proj:fa26-450-godot:developer
```
Use `:` as the delimiter, **not `-`**: your project slugs contain hyphens, and Forgejo's dynamic OIDC group maps (`{org}`/`{team}` placeholders) require delimiters that cannot occur inside org/team names.

**Directory decision — file backend first.** Start with Authelia's file backend: one YAML, zero new containers, accountant remains the sole writer, and Forgejo consumes identity via OIDC rather than LDAP. Adopt **LLDAP** only when a genuinely LDAP-only consumer appears (e.g. `pam_authelia` SSH logins, Apache `mod_authnz_ldap`, more apps). If LLDAP is adopted it stays **Authelia-exclusive** — Forgejo never talks to LDAP directly, because v17 LDAP cannot express team mapping.

---

## 4. Per-service integration matrix

| Service | Browser auth | CLI / native auth | Repo access | Authelia policy |
|---|---|---|---|---|
| **accountant** | forward-auth + trusted headers (`Remote-User`, `Remote-Groups`); accountant mints its own short-lived session. Keep `AUTH_MODE=local\|forward` for dev/tests | n/a | RBAC in DB (unchanged) | `two_factor` for `admins`, `one_factor` others |
| **subversion** (WebDAV, `svn.<domain>`) | none — **never attach cookie-session middleware to this host**: a 302 breaks `svn` | Apache Basic vs accountant-managed `passwd` (**keep**) | generated authz file (**keep**) | no middleware / `bypass` |
| **git = Forgejo** | OIDC with Authelia as IdP; group→team mapping | PAT (repo-scoped) or SSH key; `[service] ENABLE_BASIC_AUTHENTICATION=false` | org per project, teams per role | `two_factor` on the web host |
| **lore** (gRPC 41337) | unreachable by forward-auth (TLS passthrough) | Lore's own token auth | n/a | unaffected; add explicit `bypass` for clarity |
| **lore-webgui** (:7337, `AUTH=accounts`) | forward-auth *if* it can trust headers or do OIDC → **spike S3** | n/a | n/a | `one_factor`/`two_factor`, else keep own accounts as a network gate |
| **Fortune Loom** | unknown capability → **spike S3** | — | — | TBD |
| **Portainer** | break-glass: LAN-scoped `bypass` rule, or its own auth | — | — | do **not** make it Authelia-dependent (lockout risk) |

---

## 5. Changes required in accountant (design only)

1. **Extract a `server/directory/` sink module** beside the existing `server/subversion.js`, driven from the same call sites:
   - `server/routes/auth.js:124,222` (`setUserPassword` on bootstrap / reset)
   - `server/routes/user.js:279,578` (password set), `:455-457` (bulk create + sync), `:638-643` (delete → remove user, resync former projects)
   - `server/routes/project.js:181-185` (`createRepository` + `synchronizeRepositoryAccess`), `:278-284` (`renameRepository` + resync)
   Sinks: `svn-passwd`, `svn-authz` (both exist), **`authelia-users`** (new), **`forgejo`** (new, P4).
2. **Idempotent full reconcile** modelled on `rebuildAccessControlFile()` (`server/subversion.js:189` `buildAccessControlFile()`): rebuild the whole desired `users.yml`, write temp file + atomic rename onto a shared volume, and record a revision/hash so drift is detectable. Add an admin action / `npm run sync:directory`. Keep the existing in-process `withWriteLock()` discipline.
3. **Hash reuse question (spike S1).** Authelia accepts bcrypt, so the *same* bcryptjs `$2b$10$…` hash can serve both `users.yml` and the SVN `passwd` file — no shelling out to `authelia crypto hash generate`. Must verify passlib compatibility with cost 10 (Authelia's default is 12) and whether Authelia re-hashes on first login. Fallbacks: argon2 via a native node module, or shell out in the entrypoint.
4. **`users.yml` writer output** (shape):

   ```yaml
   # Generated by the Accountant service - do not edit manually.
   students:
     disabled: true            # until verification_sent_at != null
     displayname: Sam Student
     password: $2b$10$...
     email: s.student@uwstout.edu
     groups: [all_users, students, proj:fa26-450-godot, proj:fa26-450-godot:developer]
   ```
   Map `disabled` from your existing email-verification state (`isEmailVerified(user) === (user.verification_sent_at == null)`), so verification stays meaningful after SSO.
5. **Auth-mode switch for the web UI.** `server/middleware/auth.js:19-34` gains a branch: if `AUTH_MODE=forward` **and** the request's source IP is in `TRUSTED_PROXY_IPS` (Traefik's static address — not the whole `172.19.0.1/24` bridge), trust `Remote-User`/`Remote-Groups`, JIT-link to the local DB row by username, and treat the request as authenticated. Because Traefik forwards those headers on *every* request (the browser sends the Authelia cookie with same-origin XHR too), the SPA can drop `localStorage['accountant_token']` entirely — which also removes the XSS-exposed-token pattern. Keep `AUTH_MODE=local` for development and for the existing test suite.
6. **Fate of existing flows** (decisions to confirm, §8): keep accountant's bootstrap + forgot/reset as the only password paths (Authelia's are disabled); email verification either stays in accountant (recommended, drives `disabled`) or moves to Authelia's identity validation.
7. **Data-model deltas** (planning level): `User.directoryRevisionAt`, `DirectorySyncState` (hash, lastAppliedAt, lastError), `Project.gitOrg`/`gitRepo`, `Assignment.teamName`.

---

## 6. Configuration sketches (for the implementer; not applied)

**`authelia/config/configuration.yml`** essentials:

```yaml
server:
  endpoints:
    authz:
      forward-auth:
        implementation: ForwardAuth
authentication_backend:
  password_reset: { disable: true }
  password_change: { disable: true }
  file:
    path: /config/users.yml
    watch: true
    search: { email: true }
    password: { algorithm: bcrypt, cost: 10 }   # see spike S1
session:
  cookies:
    - domain: subverse.example          # MUST contain a dot, not a public suffix (spike S0)
      authelia_url: https://account.subverse.example
      default_redirection_url: https://accountant.subverse.example
  same_site: lax
  inactivity: 5m
  expiration: 1h
storage:
  local: { path: /data/db.sqlite3 }
  encryption_key: <64 chars, backed up offline>
notifier:
  smtp: { username: <brevo>, host: smtp-relay.brevo.com, port: 587, sender: subverse@... }
access_control:
  default_policy: deny
  rules:
    - domains: [account.subverse.example]
      subject: [['group:admins']]
      policy: two_factor
    - domains: [account.subverse.example]
      policy: one_factor
    - domains: [forgejo.subverse.example]
      subject: [['group:all_users']]
      policy: two_factor
    - domains: [loreweb.subverse.example]
      subject: [['group:teachers'], ['group:admins']]
      policy: one_factor
    - domain: svn.subverse.example       # CLI clients: never a cookie redirect
      policy: bypass
    - domain: lore.subverse.example      # TLS passthrough / gRPC
      policy: bypass
```

**Traefik middleware + labels** (per the [Authelia Traefik guide](https://www.authelia.com/integration/proxies/traefik/)):

```yaml
# traefik/dynamic/middlewares.yml
http:
  middlewares:
    authelia-forward-auth:
      forwardAuth:
        address: http://authelia:9091/api/authz/forward-auth
        trustForwardHeader: true
        authResponseHeaders: [Remote-User, Remote-Groups, Remote-Name, Remote-Email]
```
```yaml
# accountant router
- traefik.http.middlewares.ac-fw.forwardAuth.address=http://authelia:9091/api/authz/forward-auth
- traefik.http.routers.accountant.middlewares=ac-fw
```

**Forgejo auth source** (auth sources are DB rows, not `app.ini` sections):

```bash
forgejo admin auth add-oauth --provider openid-connect --name authelia \
  --key <client_id> --secret <client_secret> \
  --auto-discover-url https://account.subverse.example/.well-known/openid-configuration \
  --group-claim-name groups \
  --dyn-group-maps 'proj:{org}:{team}' --dyn-group-maps-removal --admin-group admins
```
`app.ini` keys: `[oauth2_client] ENABLE_AUTO_REGISTRATION=true`, `USERNAME=preferred_username`, `ACCOUNT_LINKING=auto`; `[service] DISABLE_REGISTRATION=true`, `REQUIRE_SIGNIN_VIEW=true`, `ENABLE_INTERNAL_SIGNIN=false`, `REQUIRE_EXTERNAL_REGISTRATION_PASSWORD=false`, `ENABLE_BASIC_AUTHENTICATION=false` (note: **`[service]`, not `[security]`**), `EXTERNAL_USER_DISABLE_FEATURES=manage_password,deletion`; `[openid] ENABLE_OPENID_SIGNUP=false`; `[security] DISABLE_QUERY_AUTH_TOKEN=true`.

**Forgejo admin API used by accountant** (`/api/v1`, `Authorization: token <PAT>`):
`POST /admin/users` (only `username` is required → **passwordless SSO-only accounts**, with `source_id`/`login_name`), `PATCH /admin/users/{u}` (`active`, `prohibit_login`), `DELETE /admin/users/{u}`, `POST /admin/users/{u}/rename`, `POST|GET /admin/users/{u}/tokens` (+ `DELETE .../tokens/{id}`; `CreateAccessTokenOption.repositories[]` = **repo-scoped tokens**), `POST /orgs`, `POST /orgs/{org}/teams` (`CreateTeamOption{ name, permission: read|write|admin, units_map, includes_all_repositories }`), `PUT|DELETE /teams/{id}/members/{username}`, `PUT|DELETE /teams/{id}/repos/{org}/{repo}`, `POST /orgs/{org}/repos`, `PATCH /repos/{owner}/{repo}` (rename), `POST /orgs/{org}/rename`.
⚠️ There is **no** `PUT /orgs/{org}/members/{username}` in v17 — provisioning must be team-centric.

---

## 7. Phased rollout (each phase independently rollback-able)

**P0 — prerequisites & spikes.** No user-visible change.
- Decide the domain name and PKI (`BASE_DOMAIN=subverse` is unusable for Authelia cookies); internal DNS + a CA your clients trust; fix Traefik `trustedIPs` and introduce a dedicated proxy↔app network so only Traefik can inject `Remote-*`.
- **S0** domain/cert trust end-to-end · **S1** does a bcryptjs `$2b$10$…` hash validate in Authelia's file backend, and does `watch: true` pick up an atomic write-temp+rename (and how fast)? · **S2** can Apache ever trust forward-auth headers (expected answer: no — plan stays with Apache Basic) · **S3** do `lore-webgui` / Fortune Loom support trusted headers or OIDC?
- *Exit:* spikes answered, domain + CA decided, NAS NTP verified.

**P1 — Authelia for humans only.** Deploy `authelia` (config + SQLite volumes; secrets via files: `jwt_secret`, `session.secret` ≥64, `storage.encryption_key`, OIDC HMAC/JWKS) with `default_policy: deny`; protect only `account.*` and `loreweb.*`. Nothing else changes.
*Exit:* MFA enrolment works, Brevo SMTP over TLS works, cookie scope correct, regulation behaviour understood. *Rollback:* remove the two middlewares.

**P2 — directory sync from accountant.** Ship `server/directory/` + the `authelia-users` sink; run **shadow mode** (diff DB vs file, log only), then enable. Add revision/hash + drift alerting. SVN files unchanged.
*Exit:* reconcile is idempotent (two runs produce byte-identical output); disabled accounts cannot log in.

**P3 — SSO for the accountant UI.** Attach forward-auth to its router; `AUTH_MODE=forward`; JIT-link by username; SPA stops storing a token; logout goes to the Authelia portal.
*Exit:* the affected tests (§Appendix C) pass in both modes. *Rollback:* `AUTH_MODE=local`.

**P4 — Forgejo.** Deploy behind Traefik; OIDC source + dynamic group→team maps; **org per project**, repo slug = project slug (`AlphaDashDot`, ≤100 → `fa26-450-godot` is valid); accountant provisions org/teams/members/repos through the admin API, mirroring `createRepository`/`renameRepository`/`deleteRepository`; revocation is immediate via `DELETE /teams/{id}/members/{username}` (group maps only apply at login). Git credentials: SSH + repo-scoped PATs; document loudly that **SSO does not authenticate git CLI**.
*Exit:* a student added to a project in accountant can push within one sync, and cannot after removal.

**P5 — optional SVN/directory unification.** Only if LLDAP is adopted: rebuild the gateway with `mod_authnz_ldap` so svn CLI uses the directory password while the authz file stays accountant-generated. Do **not** pursue "Apache trusts Authelia headers" (no native httpd module).

**P6 — lore / Fortune Loom.** Act on S3; add the missing `lore-udp` entrypoint if QUIC must traverse Traefik; for gRPC prefer network-level control (`access_control.rules[].networks`, entrypoint scoping) over app auth.

---

## 8. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Fail-closed SPOF** — forward-auth down ⇒ every protected host down | healthcheck + `restart: always`, monitoring, documented break-glass (Portainer on a LAN `networks` rule) |
| 2 | Dual writer on `users.yml` (Authelia password reset rewrites it) | `password_reset.disable` + `password_change.disable`; accountant is sole writer; reconcile job repairs drift |
| 3 | MFA asymmetry — Basic is always 1FA | accept it; per-app tokens for CLI; state it in user docs |
| 4 | Regulation lockout from svn clients retrying a stale password | keep Apache auth for SVN; tune `regulation.max_banned`/`banned_time`; separate service accounts |
| 5 | Per-request credential verification on chatty WebDAV | keep Apache auth, or set `scheme_basic_cache_lifespan` |
| 6 | **Header spoofing** — every container on `br-docker-trfk` is currently "trusted" | dedicated proxy↔app network, Traefik static IP, strip inbound `Remote-*`/`X-WEBAUTH-*` at the edge, app-side source-IP check |
| 7 | Logout asymmetry (no SLO) — accountant JWT outlives the Authelia session | P3 header mode / short TTLs; portal logout documented |
| 8 | Secret loss (`storage.encryption_key`, `session.secret`) ⇒ all MFA enrolments unreadable | offline secret backup; add Authelia config + DB to the backup set alongside `svn-root` |
| 9 | Config churn needs restarts on 4.39.x | keep rules coarse; store `configuration.yml` in-repo; `authelia configuration check` in CI |
| 10 | Cookie domain / PKI is a go-no-go gate, not a detail | P0 blocks everything until resolved |
| 11 | Extra proxy hop vs the tuned 502 contract (Traefik 10 s < Apache 65 s) | re-test large checkouts/commits after each middleware addition; keep `RequestReadTimeout header=60 body=0` |
| 12 | Revocation latency (`refresh_interval`, login-time group maps) | `refresh_interval: always` for the file backend + explicit API revocations |
| 13 | Test churn (10 server + 8 client tests assert bcrypt/JWT/localStorage) | keep `AUTH_MODE=local` as the test default |
| 14 | Forgejo Basic + 2FA needs an `X-FORGEJO-OTP` header on every API call | standardise on PATs; `DISABLE_QUERY_AUTH_TOKEN=true` |

---

## 9. Open questions (need answers before P0 can close)

1. Internet-facing or LAN-only — and which domain + CA will clients trust? *(blocks everything)*
2. Acceptable that `svn`/`git` CLI get **no MFA** (SSH keys / PATs instead), or is MFA-on-everything a hard requirement?
3. Will accountant's own login page be replaced by the Authelia portal (P3), or do both planes stay permanently?
4. Lean file backend now, or pay for LLDAP up front?
5. Forgejo shape: one org per project (recommended) vs one org with project-named repos — and do students need individual repos?
6. Who owns email verification from now on — accountant (as today, driving `disabled`) or Authelia's identity validation?
7. Should Portainer/infra UIs go behind Authelia too, given the lockout risk?

---

## Appendix A — Primary sources used

- Authelia: `configuration/first-factor/file` · `configuration/first-factor/ldap` · `integration/ldap/lldap` · `configuration/storage/sqlite` · `integration/proxies/traefik` · `reference/guides/proxy-authorization` · `configuration/miscellaneous/server-endpoints-authz` · `integration/trusted-header-sso/introduction` · `configuration/security/access-control` · `roadmap/active/dashboard-control-panel-and-cli-for-admins` · `https://www.authelia.com/llms.txt` (doc index)
- Forgejo: `forgejo.org/docs/latest/admin/advanced/oidc-group-mappings` · `admin/setup/authentication` · `admin/config-cheat-sheet` · `admin/command-line` · `user/api` · source at `codeberg.org/forgejo/forgejo@v17.0.1` (`routers/api/v1/api.go`, `modules/structs/admin_user.go`, `modules/structs/repo.go:143`, `models/user/user.go:660-698`, `modules/validation/helpers.go:96-126`)

## Appendix B — Still unverified (spike list)

- bcryptjs `$2b$10$…` acceptance in Authelia's file backend; cost-10 vs default 12; whether Authelia re-hashes on login.
- `watch: true` reaction to atomic rename, and reload latency.
- Whether lore-webgui or Fortune Loom can consume trusted headers / OIDC.
- Forgejo: exact max username/repo lengths in v17; INI spelling of `[service] ALLOW_DOTS_IN_USERNAMES`; whether `/users/{username}/tokens` requires admin; timing semantics of `--group-team-map-removal` and whether `[cron.sync_external_users]` re-evaluates OIDC group maps.
- Any Synology-specific Authelia guidance (none exists in upstream docs).

## Appendix C — Tests that will need attention in P3

Server: `auth-routes.test.js`, `bootstrap-routes.test.js` (asserts `bcrypt.hash('sup3r-secret', 10)`), `password-reset.test.js`, `middleware.test.js`, `subversion.test.js` (rejects `{SHA}`/`$apr1$`/plaintext in `setUserPassword`), `user-routes.test.js`, `project-routes.test.js`, `class-routes.test.js`, `offering-routes.test.js`.
Client: `api.test.js` (token helpers, `Authorization` headers), `AuthContext.test.js`, `Login.test.jsx`, `PrivateRoute.test.jsx`, `RequireRole.test.jsx`, `ForgotPassword.test.jsx`, `ResetPassword.test.jsx`, `VerifyEmail.test.jsx`.
Note `scripts/seed.mjs` writes **only** the database (40 users, bcrypt cost 10) — seeded users do not exist in SVN or Authelia until a directory sync runs.
