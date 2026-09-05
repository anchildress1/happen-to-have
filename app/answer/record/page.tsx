import Link from 'next/link';
import { copy } from '@/copy';
import { AppHeader } from '@/ui/AppHeader';
import { Screen } from '@/ui/Screen';
import { Watermark } from '@/ui/Watermark';

/**
 * Placeholder; 003 replaces this route. Touches no recording API — SC-005 asserts zero
 * getUserMedia calls anywhere in this feature, and this route is inside it until then.
 */
export default function RecordPlaceholder() {
  return (
    <Screen header={<AppHeader />}>
      <Watermark />
      <h1>Recording isn&rsquo;t built yet</h1>
      <p>This is where you&rsquo;d record your answer. It lands with the next slice of work.</p>
      <Link href="/answer">{copy.action.tryAnother}</Link>
    </Screen>
  );
}
