import { Screen } from '@/ui/Screen';

// Placeholder only — 005 (Yours & Playback) owns the real screen at this
// route. This exists so AppHeader's `Yours` link never 404s (T040).
export default function YoursPlaceholderPage() {
  return (
    <Screen>
      <p>Yours is on its way — spec 005 builds this screen.</p>
    </Screen>
  );
}
