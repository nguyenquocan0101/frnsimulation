# Brainstorm: VPS ONNX submissions linked to Firebase

**Date:** 2026-08-12

## Ideas Explored

- Google Drive with a service account: rejected because service accounts cannot own files in My Drive and the available account had no Shared drive.
- Google Drive OAuth as the human owner: workable but rejected for the workshop after OAuth client setup became operationally expensive.
- Cloudflare R2: strongest long-term object-storage option, but adds account and bucket setup that the user wants to avoid for this workshop.
- VPS object storage behind a public tunnel: selected because the VPS already exists and the workshop needs a small, quickly deployable backend.
- Storing both `main.py` and ONNX on the VPS: rejected because Firebase already stores code submissions correctly.
- Linking by team name: rejected because one team can submit multiple versions; names are not unique submission identities.
- Linking by `submissionId`: selected because the existing Firebase workflow already generates one immutable ID per submission.

## User's Direction

Keep `main.py` in Firebase. Store only one `model.onnx` per submission on the VPS. Students enter a group name and submit both parts in one web flow. Teachers use the existing administration page to view and download the paired files. Use fixed password `090909` for the temporary teacher gate and Cloudflare Quick Tunnel because no domain is available.

## Open Questions

- No product decision is blocking planning. Deployment must measure VPS disk capacity and determine the installed Linux distribution before choosing exact service commands.

## Risks

- A Quick Tunnel URL is not stable and must be updated in the deployed website after tunnel recreation.
- A password shipped to browser code is discoverable and provides convenience gating only; it must not be reused for VPS or other accounts.
- Public large-file uploads can exhaust disk or bandwidth; Firebase token validation, strict limits, temporary-file cleanup, and free-space checks are required.

