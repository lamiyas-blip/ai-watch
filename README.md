# AI Watch

Checks about 35 AI feeds every 30 minutes, sends a phone notification for new posts from the sources you choose, and publishes a mobile app with a Refresh button.

How it fits together: a GitHub Actions job runs `scripts/watch.mjs`, which reads `feeds.json`, writes `docs/feed.json`, and sends notifications through ntfy. GitHub Pages serves the `docs/` folder as the app.

## Setup (about 15 minutes, on a computer)

1. **Phone:** install the free **ntfy** app (iOS or Android). Tap +, then subscribe to your private topic name. Treat the topic like a password: anyone who knows it can read and send to it.
2. **GitHub:** create a new **public** repository called `ai-watch` (leave it empty). Public is needed for free GitHub Pages. The repo holds only article titles and links, never your topic.
3. **Upload:** unzip this folder, open a terminal inside it and run:
   ```
   git init
   git add -A
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/ai-watch.git
   git push -u origin main
   ```
4. **Secret:** repo Settings, Secrets and variables, Actions, New repository secret. Name `NTFY_TOPIC`, value your topic name.
5. **Permissions:** Settings, Actions, General, Workflow permissions, choose **Read and write permissions**, Save.
6. **App hosting:** Settings, Pages, Source "Deploy from a branch", Branch `main`, folder `/docs`, Save.
7. **First run:** Actions tab, "Watch feeds", Run workflow, tick "Send a test notification". Your phone should buzz within a minute. This first run only records what already exists, so it will not flood you with old posts.
8. **Install the app:** open `https://YOUR-USERNAME.github.io/ai-watch/` on your phone and choose Add to Home Screen. It can take a couple of minutes for Pages to go live.

## Changing what you watch

Edit `feeds.json` on GitHub. For each source, `"notify": true` sends a push and `false` only lists it in the app. `keywords` limits a source to titles containing those words. Start with a few notify sources and turn on more once you see the volume.

## Good to know

- **Not covered:** X/Twitter accounts (no free feed), arXiv (hundreds of papers a day) and Hugging Face papers.
- **Reddit** sometimes blocks GitHub's servers. If so, the app's "sources not working" list shows it and everything else keeps running.
- **Some feed addresses may be wrong or change.** The "Watching N sources" note at the bottom of the New tab lists any source that failed, with the reason.
- **Timing:** GitHub runs scheduled jobs roughly every 30 minutes, sometimes later.
- **Bookmarks and your prediction log** are saved in the browser on each device, so they do not sync between phone and laptop.
- If a repo has no activity for 60 days, GitHub may pause the schedule. Re-enable it in the Actions tab.

## Development

`npm install`, then `npm test`. `DRY_RUN=1 node scripts/watch.mjs` prints notifications instead of sending them.
