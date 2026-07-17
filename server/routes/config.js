/* Public client configuration.
   The app has no build step, so values the browser needs but must not be
   hard-coded into a committed file are fetched from here at runtime.
   Everything on this route is public by definition — never add a secret. */
import { Router } from 'express';
import { config } from '../env.js';

const router = Router();

router.get('/config', (req, res) => {
  const { theme, uiType } = config.client;
  res.json({
    // The interface types this build knows how to be: { "1": "native", "2": "google_based" }.
    uiTypes: config.uiTypes,
    // What a plain visit gets. null/'' = the client decides (its own default
    // theme; the theme's own ui.type). A value here overrides the theme.
    theme: theme || null,
    uiType,
    // Browser key for the Google Maps JS API (ui.type 2). Restrict it by HTTP
    // referrer in the Google console — it is visible to anyone.
    googleMapsApiKey: config.googleMapsBrowserKey,
    // ui.type 2 cannot run without the key. Saying so here lets the client stay
    // on the built-in map instead of mounting Google and failing in the browser.
    googleMapsAvailable: !!config.googleMapsBrowserKey,
  });
});

export default router;
