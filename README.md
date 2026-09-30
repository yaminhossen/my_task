# Simple Notes

A tiny offline checklist app (Progressive Web App) built with plain HTML, CSS and JavaScript.
No frameworks, no build step, no server-side code. Everything is stored on the device in `localStorage`.

- The home page shows all your lists, grouped by date (Today, Yesterday, then older dates).
- The + button on the home page creates a list with a title and a date (defaults to today).
- Open a list to add tasks with its own + button. The back arrow, or the phone's back gesture, returns home.
- Unchecked tasks are always on top, in the order they were created.
- Checked tasks are always at the bottom, in the order they were checked.
- Unchecking a task puts it back in its original position.
- Works offline once it has been opened.
- Installs on Android via Chrome.

## Project structure

```
index.html      Page markup (header, home page, list page, + button, list and task sheets)
style.css       Mobile-first styles (light and dark)
app.js          Storage layer, list and task logic, rendering, navigation, service worker registration
manifest.json   PWA manifest (name, icons, standalone display)
sw.js           Service worker: caches the app files for offline use
icons/          App icons (192px and 512px)
```

## Run locally

Service workers only run on `https://` or `http://localhost`, so don't open `index.html` by double-clicking it (`file://`). Serve the folder with any static server instead:

- **VS Code:** install the "Live Server" extension, right-click `index.html`, and choose "Open with Live Server".
- **Node:** `npx http-server -p 8080 -c-1`, then open http://localhost:8080
- **Python:** `python -m http.server 8080`, then open http://localhost:8080

## Install on an Android phone

Your phone must load the app over **HTTPS**. A plain `http://192.168.x.x` address won't install or work offline. There are two options:

**Option A: host it (recommended).** Upload this folder to any free static host that serves HTTPS, such as GitHub Pages, Netlify Drop (drag and drop the folder) or Cloudflare Pages. All paths are relative, so a subfolder URL like `https://you.github.io/notes/` works.

**Option B: USB port forwarding (for testing).**
1. Start a local server on port 8080 on your PC.
2. On the phone, enable Developer options and USB debugging, then connect it by USB.
3. On the PC, open `chrome://inspect/#devices` in Chrome, click "Port forwarding", and add `8080` → `localhost:8080`.
4. On the phone, open `http://localhost:8080` in Chrome.

Then, in Chrome on the phone:
1. Open the app URL once while online, so it gets cached.
2. Tap the ⋮ menu, then "Install app" (or "Add to Home screen").
3. Open **Notes** from the home screen. It runs full-screen and works offline.

## How data is stored

`app.js` has one storage helper, `Store`. It is the only code that reads or writes `localStorage`.

- Key: `simple-notes.data.v2`
- Value: all lists, each with its own tasks:

```json
{
  "version": 2,
  "lists": [
    {
      "id": "…", "title": "Daily", "date": "2026-09-30", "order": 1,
      "tasks": [
        { "id": "…", "text": "Buy medicine", "completed": true,  "order": 1, "completedOrder": 6 },
        { "id": "…", "text": "Go to market", "completed": false, "order": 3, "completedOrder": null }
      ]
    }
  ]
}
```

- `date` is the date you chose for the list. The home page groups lists by it.
- A task's `order` is set when the task is created. Unchecked tasks are sorted by it.
- `completedOrder` is set each time the task is checked. Checked tasks are sorted by it, so the most recently checked task is last.
- Everything is saved after every change to a list or a task.
- On startup, missing data means no lists. Invalid lists or tasks are skipped. If the saved data can't be read at all, it is copied to `simple-notes.data.v2.corrupt-backup` and the app starts empty.
- Tasks saved by the earlier single-list version (key `simple-notes.tasks.v1`) are moved into a list called "My Tasks" the first time the new version runs.

## Updating the app

After changing any file, increase `CACHE_NAME` in `sw.js` (for example `simple-notes-v10`). Otherwise installed copies keep serving the old cached files. The new version loads on the next launch after the update has downloaded.

## Limitations

- Data lives only in this browser on this device. There is no sync or backup. Clearing Chrome's site data or uninstalling the app deletes your notes.
- Each browser, and each installed copy, has its own separate data.
- `localStorage` holds roughly 5 MB, which is far more than a text checklist needs.
- The app asks the browser to keep its storage persistent, but browsers decide whether to honor that.
