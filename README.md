# LeadFlow

Private Indonesian lead-management workspace: static dashboard + Vercel Node functions + Turso. No public lead seed and no automatic replies.

## Production setup
Open Vercel project syren1/leadflow → Settings → Environment Variables → Production. Copy keys from .env.example, set values in Vercel; never commit secrets. Use Node 22 and Other framework. Generate distinct admin, import and cron tokens with `openssl rand -hex 32`.

Required: TURSO_DATABASE_URL (provided), TURSO_AUTH_TOKEN (Turso dashboard or `turso db tokens create leadflow`), ADMIN_TOKEN (24+ chars). IMPORT_TOKEN enables scoped ingestion, CRON_SECRET authorizes Vercel cron. Redeploy after changes. The tables are initialized on the first authenticated request.

## Import and workflow
Log in with ADMIN_TOKEN. Paste a JSON array or Markdown table name | phone | email. JSON supports name, phone, email, category, location, source and priority (0–100). Max 100 per import. Duplicate name/phone/email skipped. Review sources; import never sets consent. No automatic transfer from ChatGPT exists yet: copy the daily Finder table or use the documented authenticated endpoint from a trusted integration.

```bash
curl -X POST "$LEADFLOW_URL/api/leadflow?action=import" \
 -H "Authorization: Bearer $IMPORT_TOKEN" -H "Content-Type: application/json" \
 -d '{"leads":[{"name":"Example business","phone":"081234567890","category":"wedding","priority":90}]}'
```

Use Detail to generate/copy drafts, record verifiable WhatsApp opt-in, mark a manually contacted lead or block. Optional AI uses an OpenAI-compatible HTTPS base URL (including /v1), AI_API_KEY and AI_MODEL. If 9Router is only bound to localhost on Azure, Vercel cannot access it; use deterministic drafts or a securely authenticated HTTPS gateway. AI drafts are never sent automatically.

## WhatsApp first-message automation
Use Meta WhatsApp Business Platform Cloud API; do not send to numbers merely published in directories. Configure a WhatsApp Business account and phone number, approved marketing template(s) with exactly one positional body text parameter {{1}} for business name, and no additional required parameters. Example template body for Meta approval: "Halo tim {{1}}, saya web developer asal Garut. Saya menawarkan jasa website profesional dan contoh desain awal gratis tanpa kewajiban pemesanan. Jika tidak ingin menerima penawaran lagi, mohon beri tahu saya. Terima kasih." Do not assume Meta will approve. Set WA_ACCESS_TOKEN (authorized system user token), WA_PHONE_NUMBER_ID, WA_GRAPH_VERSION (supported version in your Meta dashboard, format vNN.0), WA_TEMPLATE_NAMES (comma-separated approved names with same parameter schema), WA_TEMPLATE_LANGUAGE (id) and WA_DAILY_LIMIT (default 5, maximum 10). Set WA_AUTO_SEND=true only after setup and testing on your own opted-in test recipient. Set CRON_SECRET. Redeploy. Dashboard starts paused; explicitly enable queue after recording evidence. Cron runs once daily around 09:00 Jakarta, subject to Vercel plan timing. No automated follow-ups or retries. Pause stops future claims, not an in-flight request. Mark opt-outs immediately in dashboard/WhatsApp Manager; no inbound webhook is implemented. Verify manual takeover using supported Business app coexistence or Meta-compatible inbox before enabling. Status submitted means API accepted, not delivered; unknown/sending requires manual verification, no automatic resends. Email remains in the existing ChatGPT automation, not this app. Always keep sending disabled if consent or manual inbox is unavailable.

## Tests
`npm install`, `npm test` runs normalization, validation, consent and payload unit tests. `npx vercel dev` for local testing. This app is not a full CRM, has no autonomous discovery and no automatic ChatGPT-to-backend bridge yet. The import API is ready for a trusted integration. Never use public secrets or store private contacts in Git.

## Finder multiple batches (V4 / wire V3)
Deploy backend first. It creates an additive `finder_batches` table, preserving legacy `finder_runs` and leads. Legacy V1/V2 endpoints remain supported. Replace the active Apps Script source with `integrations/leadflow-sync.gs`, keeping existing properties and trigger; run syncLeadFlow once and confirm config email includes batch_protocol:3. Only then activate `integrations/gpt-finder-v4-prompt.md`. Config mode=batch returns remaining daily NEW leads; legacy mode still returns once-per-day campaigns. Each V3 batch has at most five candidates, stable unique batch_id and is atomic/idempotent; same ID with changed payload returns 409. Daily capacity is guarded inside the transaction. A batch larger than remaining is rejected. Historical V2 runs count toward today's added total; V3 batch count only counts V3 events. A run stops at its own search budget; GAS does not trigger GPT recovery. Use another scheduled iteration for remaining work. No automated outreach changes.

## Finder V4.2 dynamic batch size
Finder Studio offers 5 or 10 candidates per batch, default 10. Backend enforces configured size and daily remaining; configuration changes rotate revision. The batch config endpoint advertises at most 5 to older GAS callers; the updated script opts in with `max_batch=10`. Replace active GAS script and run syncLeadFlow to publish the new config. The V4.2 scheduler accepts either size and sends one batch per run. Existing tables and wire protocol 3 are unchanged. Never send outreach automatically.

## Customer workspace
Customer queue, history and delivery review are separate hash-routed pages. Queue groups by Jakarta intake date and recorded batch; defaults to today, with older/all tabs. History includes submitted (not delivery confirmed), manually contacted, and blocked records; pending/unknown dispatch is isolated for review. Additive metadata migration leaves old unknown timestamps and attribution null; legacy WhatsApp attempts are shown as attempt times. New Finder imports record campaign/batch on actual insertion only. Admin list pagination supports all rows via cursor; UI auto-refreshes while visible and logged in. Opening history details only reads Hina status. No change to consent or outbound sending rules.
