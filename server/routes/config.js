/* Public client configuration.
   The app has no build step, so values the browser needs but must not be
   hard-coded into a committed file are fetched from here at runtime.
   Everything on this route is public by definition — never add a secret. */
import { Router } from 'express';
import { config } from '../env.js';

const router = Router();

router.get('/config', (req, res) => {
  res.json({
    // Browser key for the Google Maps JS API (theme ui.type 2). Restrict it by
    // HTTP referrer in the Google console — it is visible to anyone.
    googleMapsApiKey: config.googleMapsBrowserKey,
  });
});

export default router;
