# UMBRA

A top-down 2D stealth game: sneak past patrolling guards, take them down from behind, hide the bodies and reach the exit.
100 levels across 10 chapters, each ending in a boss.

**Play:** https://coder-4847.github.io/Umbra/

Keyboard and mouse, gamepad and touch are supported. Progress is saved in the browser.

## Development

```bash
npm install
npm run dev      # game at http://localhost:5173/, level editor at /editor.html
npm run build    # static site in dist/
```

Built with PixiJS and Vite; all audio is synthesised at runtime. Pushing to `master` builds and deploys to GitHub Pages
(`.github/workflows/deploy.yml`).
