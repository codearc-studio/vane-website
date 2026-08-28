Vane website
Live domain: https://vane.codearc.studio

Hosting:
- GitHub is the source repository
- Vercel deploys automatically from the repository

Pages:
- /
- /contact/
- /privacy/
- /terms/

Local testing:
1. cd into the vane-website folder
2. Run: python3 -m http.server
3. Open: http://localhost:8000

Deploy:
git add .
git commit -m "Update Vane website"
git push

Note:
This ZIP intentionally does not include the .git folder. Copy/replace these files
inside your existing Git repository so your Git history and remote stay intact.

SHORT VANE ALERT LINKS
----------------------
Vane now creates six-character alert codes such as:
https://vane.codearc.studio/a/7K2P4Q

The /api/alert Vercel Function stores the short-code-to-Apple-alert-ID mapping in Vercel Blob.
One-time setup in the Vercel project:
1. Add/connect a Vercel Blob store.
2. Make sure BLOB_READ_WRITE_TOKEN is available to Production (Vercel adds this when the store is connected).
3. Redeploy.

Until Blob is connected, the iOS app safely falls back to the previous long Vane alert URL.
