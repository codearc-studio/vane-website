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
- /a/{6-character alert code}

Deploy:
git add .
git commit -m "Update Vane website"
git push

Note:
This ZIP intentionally does not include the .git folder. Copy/replace these files
inside your existing Git repository so your Git history and remote stay intact.

SHORT VANE ALERT LINKS
----------------------
Vane creates six-character alert codes such as:
https://vane.codearc.studio/a/7K2P4Q

The iOS app sends the official Apple Weather alert ID plus the alert's title,
severity, area, issuing agency, issued/end times, and official details URL to
/api/alert. The function stores that public weather-alert metadata in Vercel Blob.
The /a/{code} route is rendered server-side so shared links get alert-specific
text previews without using the Vane homepage OG image.

One-time Vercel Blob setup:
1. Open the existing vane-website project in Vercel.
2. Go to Storage, create/connect a Blob store, and choose PUBLIC access.
   These records contain only public official weather-alert metadata.
3. Connect the store to the vane-website project. Vercel should add
   BLOB_READ_WRITE_TOKEN to the project automatically.
4. Redeploy the production site.

CLI alternative from the vane-website folder:
  npx vercel link
  npx vercel blob create-store vane-alerts --access public --yes
  npx vercel env pull .env.local
  npx vercel --prod

Use `vercel dev` for local testing of /api/alert and /a/{code}; a plain
python3 -m http.server cannot run Vercel Functions.

Until Blob is connected, the iOS app safely falls back to the previous long
Vane alert URL instead of producing a broken short link.
