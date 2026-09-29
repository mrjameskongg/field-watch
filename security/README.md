# Security

Two layers protect this app.

## 1. Free CI layer (always on)

`.github/workflows/security.yml` runs on every push, every PR, and weekly. Zero
cost, no keys. Jobs:

- **gitleaks** — scans full git history for committed secrets (API keys, tokens).
- **semgrep** — static analysis of React/TS and the Deno edge functions, plus
  secret patterns, OWASP and injection rules (`--config auto`).
- **CodeQL** — dataflow/taint analysis (public repo only; free code scanning).
- **npm audit** — production dependency vulnerabilities, high and up.
- **RLS policy drift** — regenerates the Supabase row-level-security policy block
  from `src/lib/roles-core.ts` and fails if the committed migration is stale, so
  the database policies can never silently diverge from the source of truth.

Findings appear in the **Security** tab (public repo) or the failing **job log**.

## 2. Strix — on-demand AI pentest (manual)

[Strix](https://github.com/usestrix/strix) runs AI agents that actively probe the
app like a real attacker (HTTP proxy, browser exploitation, SAST + DAST). It is
**not** in CI because it needs a paid LLM key and spends credits per run.

### Setup (once)

1. Install Docker Desktop and start it.
2. `pipx install strix-agent`  (or `pip install strix-agent`)
3. Get an LLM API key and pick a model — see https://docs.strix.ai
   ```sh
   export LLM_API_KEY="your-provider-key"
   export STRIX_LLM="provider/model"   # exact string per Strix docs
   ```

### Run

```sh
./security/strix-scan.sh          # scans this repo
./security/strix-scan.sh https://your-deployed-url   # scans a live target
```

Point it at the deployed Cloudflare/Supabase URL for a real dynamic test, or at
the code directory for static review.

---

**Note:** no tool makes an app "bulletproof." This layer catches known vuln
classes, leaked secrets, and policy drift automatically, and Strix hunts for the
rest on demand. Real security also depends on Supabase RLS being correct, service
keys never shipped to the client, and edge functions validating every input.
