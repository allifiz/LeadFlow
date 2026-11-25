# Proposal Bridge setup (separate Apps Script)

Deploy LeadFlow changes first to an isolated preview; use a separate test Turso database when testing. Existing Finder GAS and scheduled automation remain unchanged. The proposal workflow is on-demand: submit calls a standalone web app; a temporary one-minute trigger polls Gmail results only while requests exist, and removes itself when idle.

1. Create a private Drive folder for proposal PDFs. Copy its folder ID.
2. Generate two distinct random 32+ character secrets locally (e.g. openssl rand -hex 32). Do not paste secrets in chat or commit them.
3. Create a NEW standalone script at https://script.google.com/home/projects/create. Paste integrations/leadflow-proposal-bridge.gs into Code.gs.
4. In Project Settings > Script Properties add PROPOSAL_ENDPOINT (https://leadflow-topaz-eta.vercel.app/api/leadflow for production, or isolated preview URL for testing), PROPOSAL_BRIDGE_TOKEN, PROPOSAL_WEBHOOK_SECRET, PROPOSAL_OWNER_EMAIL (your own Gmail), PROPOSAL_FOLDER_ID, optional PROPOSAL_VERCEL_BYPASS if preview is protected. Run authorizeProposalBridge once and approve scopes. Do not install a recurring trigger manually.
5. Deploy > New deployment > Web app > Execute as Me > Who has access: Anyone (if allowed by account). The public endpoint checks a dedicated secret in POST body; use HTTPS only. Copy the /exec URL. Do not put secrets in URL parameters.
6. In the intended Vercel environment configure PROPOSAL_BRIDGE_URL (/exec URL), PROPOSAL_BRIDGE_TOKEN, PROPOSAL_WEBHOOK_SECRET (matching GAS values); redeploy. Finder IMPORT_TOKEN is not used.
7. In ChatGPT Work, if available on your account, create a Gmail incoming-email event task for LEADFLOW_PROPOSAL_REQUEST_V1; use the instructions in integrations/gpt-proposal-writer-v1.md. Connect Gmail and Drive/Docs. Confirm the event can match a self-email and that sending self-email and creating a native Google Doc are authorized. This setup is manual if the event API is unavailable.
8. Submit a fictional test customer in Proposal Studio. Verify queued -> published -> completed, actual Google Doc and PDF links, then approve. Try revision and verify a second version. Verify one request email and one result email per UUID and that PDF remains private. No customer outreach is part of this test.

If webhook is not configured or fails, the proposal remains queued and can be retried from Studio. If GPT does not return a result within 48 hours, the bridge marks failed; create a revision to retry. Published means request email was sent, not that ChatGPT has started. The PDF is exported by GAS from the Google Doc, and preview opens Drive rather than embedding it. Never share files publicly or use real customer data until the end-to-end test passes.
