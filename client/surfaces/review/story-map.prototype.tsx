// Development-only gateway comparison runner; production mounts StoryMap directly.
import { mountStoryMap } from './StoryMap';
import type { ReviewPayload } from '../../../src/payloads';
import type { StoryMapData } from '../../../src/story-map';
const payload: ReviewPayload = JSON.parse(document.querySelector('#__CODESTORY_DATA__')!.textContent!);
const data: StoryMapData = await (await fetch('/_prototype/map.json' + (new URL(location.href).searchParams.get('scope') === 'full' ? '?scope=full' : ''))).json();
void mountStoryMap(payload, data, block => '/_prototype/viewer?id=' + encodeURIComponent(block.viewerId));
