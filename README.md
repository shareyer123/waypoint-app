# ◆ Waypoint

A fully local notebook for a folder of markdown notes ("a vault"), with `[[wikilinks]]`, a live graph
and live sync — built to sit next to an AI agent that edits the same files.

- **Notes list** as a folder tree, with search by name and content.
- **Rendered markdown:** headings, lists, task boxes, tables, code, quotes, front matter, vault images.
- **`[[Wikilinks]]`**, including `[[Note|alias]]`, `[[folder/Note]]` and `[[Note#Heading]]`. A link to a
  missing note is grey and dashed; click it to create the note. Each note lists what links to it.
  When two notes share a name, a link goes to the one nearest the linking note.
- **Graph:** click a node to open the note; drag, zoom, pan, double-click to fit.
  **Split** (note + graph side by side) is the default on windows 900 px or wider.
- **Click to edit, autosave:** click into a note and type. It saves itself shortly after you stop, and
  when you leave the note or close the window.
- **Live sync:** when another program adds, changes or deletes a note, Waypoint updates at once. If you
  are typing in that note, a banner asks **Reload** or **Keep mine**.
- Notes in a `sessions` folder show orange in the graph.

## Install and run

You need **Node.js 20 or newer** (`node --version`).

```
git clone https://github.com/shareyer123/waypoint-app.git
cd waypoint-app
npm install
npm start
```

`npm install` downloads Electron (about 100 MB) one time.
The first start shows **Browse for a folder** — pick your vault. Waypoint remembers it.
After that, double-click **`Waypoint.cmd`** (Windows) to open it without a console window.
To open a given folder: `npm start -- "C:\path\to\vault"`.

## Keys

| Keys | Action |
|---|---|
| (click a note) | Edit it; it saves itself about 1 second after you stop typing |
| Esc | Finish editing |
| Ctrl+S | Save now |
| Ctrl+N | New note |
| Ctrl+G | Note → Graph → Split |
| Ctrl+O | Open vault |
| Ctrl+F | Search notes |

## Privacy

- **No network.** The app cancels every request that is not a local file, and the page's
  Content-Security-Policy blocks network access as a second layer. No telemetry, no auto-update.
- Links to websites open in your normal browser **only after you confirm**.
- Notes are read from and saved to your vault folder, nowhere else. The only other file is
  `%APPDATA%\Waypoint\config.json` (the last vault path).
- One dependency: Electron. No other third-party code.

## Limits

- Images load only from inside the vault. Outside images show as a placeholder.
- Files and folders starting with `.`, `node_modules`, and a folder named `_Template` are hidden.

## Development

```
npm test        # unit tests (node:test, no extra dependencies)
```

## License

MIT — see `LICENSE`.
