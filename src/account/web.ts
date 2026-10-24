// The web version (GitHub Pages): the app on its own, with no HarpForge server behind it. Its
// songs are kept in the browser; accounts come with running HarpForge on your own computer.
// Built with VITE_HARPFORGE_WEB=1 (see .github/workflows/pages.yml).

/** Whether this is the web version, with no server to have accounts on. */
export const WEB_ONLY = import.meta.env.VITE_HARPFORGE_WEB === '1';

/** Where HarpForge's code is, and how to run it yourself. */
export const REPO_URL = 'https://github.com/Almer113/harpforge';
