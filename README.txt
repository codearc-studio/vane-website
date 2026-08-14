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
