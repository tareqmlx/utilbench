/**
 * Puppeteer configuration.
 *
 * Only the full Chrome browser is needed — `scripts/prerender.ts` launches with
 * `headless: true`, which uses full Chrome (not the legacy chrome-headless-shell).
 * Skip the chrome-headless-shell download so a corrupt/partial cache for it can't
 * fail `bun install`'s postinstall step.
 */
module.exports = {
  "chrome-headless-shell": {
    skipDownload: true,
  },
};
