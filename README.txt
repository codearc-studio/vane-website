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

VERIFIED VANE OFFICIAL ALERTS
-----------------------------
Vane creates six-character alert codes such as:
https://vane.codearc.studio/a/7K2P4Q

The iOS app sends only the Apple Weather alert UUID and a language preference to
/api/alert. Client-supplied headline, severity, area, issuing agency, timing, and
message text are intentionally ignored.

The Vercel function signs its own WeatherKit REST request and retrieves the active
alert from Apple at:
  GET https://weatherkit.apple.com/api/v1/weatherAlert/{language}/{id}

The verified response is normalized and stored in a private Vercel Blob record.
It can include the event title, severity, affected area, issuing agency,
certainty, urgency, recommended responses, issue/effective/onset/end/expiration
times, and the full official agency message. The /a/{code} route renders that
verified snapshot server-side for sharing and social previews.

Existing alert UUID -> short-code mappings are preserved. If Apple cannot refresh
an alert later, a previously server-verified snapshot is never overwritten by
client data. Older records created before server verification are displayed as
legacy snapshots instead of being labeled verified.

ONE-TIME VERCEL BLOB SETUP
--------------------------
1. Open the existing vane-website project in Vercel.
2. Go to Storage and create/connect a PRIVATE Blob store.
3. Connect it to the vane-website project so BLOB_READ_WRITE_TOKEN is available.
4. Redeploy production.

CLI alternative from the vane-website folder:
  npx vercel link
  npx vercel blob create-store vane-alerts --access private --yes
  npx vercel env pull .env.local

ONE-TIME WEATHERKIT SERVER SETUP
--------------------------------
Apple WeatherKit REST requests need a server-side developer token. In the Apple
Developer portal:
1. Make sure WeatherKit is enabled for the Vane App ID.
2. Register a Services ID for the Vane website/server, for example:
   studio.codearc.vane.weatherkit
3. Create/download a private key with WeatherKit enabled and keep the .p8 file
   private. Note its 10-character Key ID.
4. Note the Apple Developer Team ID and the Services ID from step 2.

Add these Vercel environment variables to Production (and Preview/Development if
wanted):
  WEATHERKIT_TEAM_ID        = your 10-character Apple Team ID
  WEATHERKIT_KEY_ID         = the WeatherKit key's 10-character Key ID
  WEATHERKIT_SERVICE_ID     = the Services ID from step 2
  WEATHERKIT_PRIVATE_KEY    = the full contents of the downloaded .p8 private key

WEATHERKIT_PRIVATE_KEY may be pasted as a normal multiline PEM value. The server
also accepts a value whose line breaks are stored as literal \\n characters.
Never put the .p8 key in the iOS app, Git repository, or public client code.

After setting the variables:
  npx vercel --prod

Use `vercel dev` for local testing of /api/alert and /a/{code}; a plain
python3 -m http.server cannot run Vercel Functions.

PRIVATE BLOB NOTE
-----------------
The alert JSON is only read/written server-side using BLOB_READ_WRITE_TOKEN.
Shared /a/CODE pages are public web pages, but the underlying Blob records remain
private.
