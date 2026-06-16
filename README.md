# Antigravity Gantt Charter

> **Developed by Jonathan Jubin in collaboration with [Antigravity](https://github.com/jubinjo).**
> Licensed under the **MIT License** — free to use, copy, modify, and distribute, with or without attribution, provided the original copyright notice is retained. Provided *as is*, without warranty of any kind.

🔗 **[Open the live app](https://jubinjo.github.io/Antigravity_Gantt_charter/)**

---

## What is it?

Antigravity Gantt Charter is a fully **offline, browser-based** Gantt chart tool designed for research project planning. No installation, no server, no account — just open the page and start planning.

To maximize privacy and security, **this application does not use cookies, local storage, or server connections**. All data is stored purely in-memory in your active browser tab. Use the **Export** button to download your work as a JSON file, and **Import** to load it back in.

---

## Features

- 📁 **Projects** — Organize tasks by color-coded projects
- ✅ **Tasks** — Add tasks with flexible start modes (specific date or dependency on another task) and end modes (duration in weeks or hard end date)
- 🔁 **Recurring tasks** — Automatically repeat a task across multiple years
- 📌 **Deadlines** — Pin milestone markers to any task
- 🔍 **Filters** — Filter the chart and list by project and/or assignee
- 🔎 **Zoom & pan** — Adjustable timeline zoom (4 months → 3 years) and scrollable start date
- 🌙 **Dark / Light theme** — Toggle at any time
- 📤 **Import / Export** — Save and load your data as JSON (essential for saving work since data is in-memory only)
- ↩️ **Undo / Redo** — Full history support

---

## Usage

No installation required. Visit the live app:

**➡️ [https://jubinjo.github.io/Antigravity_Gantt_charter/](https://jubinjo.github.io/Antigravity_Gantt_charter/)**

Or clone this repository and open `index.html` directly in any modern browser:

```bash
git clone https://github.com/jubinjo/Antigravity_Gantt_charter.git
cd Antigravity_Gantt_charter
# Open index.html in your browser — no build step needed
```

---

## Files

| File | Description |
|------|-------------|
| `index.html` | App structure and modals |
| `index.css` | All styling (dark/light themes, layout, components) |
| `app.js` | All application logic (rendering, state, events) |
| `LICENSE` | MIT License text |

---

## License

MIT License — Copyright © 2026 Jonathan Jubin

You are free to **use, copy, modify, merge, publish, distribute, sublicense, and/or sell** copies of this software.

**Key conditions:**
- The copyright notice and this permission notice must be **included in all copies or substantial portions** of the software.
- The software is provided **"as is"**, without warranty of any kind.
- The author is **not liable** for any claim, damages, or other liability arising from its use.

See [`LICENSE`](LICENSE) for the full license text.
