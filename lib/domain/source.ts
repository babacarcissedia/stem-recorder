import { assertNonNegativeMs, type Ms } from './ms.ts';
import { type SourceId } from './clip.ts';
import { invariant } from './invariant.ts';

export type SourceKind = 'video' | 'audio' | 'image' | 'text';
export type SourceOrigin = 'capture' | `import` | 'generated';

export type Source = {
  id: SourceId;
  path: string;
  label: string;
  kind: SourceKind;
  availableDuration: Ms;
  hasAudio: boolean;
  present: boolean;
  origin: SourceOrigin;
  peaksKey: string | null;
};

export function makeSource(init: Partial<Source> & Pick<Source, 'id' | 'kind'>): Source {
  invariant(typeof init.id === 'string' && init.id.length > 0, 'SOURCE_ID_REQUIRED');
  return {
    id: init.id,
    path: init.path ?? '',
    label: init.label ?? init.path ?? init.id,
    kind: init.kind,
    availableDuration: assertNonNegativeMs(init.availableDuration ?? 0, 'availableDuration'),
    hasAudio: init.hasAudio ?? false,
    present: init.present ?? true,
    origin: init.origin ?? 'capture',
    peaksKey: init.peaksKey ?? null,
  };
}

export type AudioRoute = {
  activeSourceId: SourceId | null;
  resolvedBy: 'auto' | 'user';
};

export function resolveAudioRoute(sources: Iterable<Source>, camLabel = 'cam.mp4'): SourceId | null {
  const audible = [...sources].filter((source) => source.hasAudio && source.present);
  const cam = audible.find((source) => source.kind === 'video' && source.label === camLabel);
  if (cam) return cam.id;
  const video = audible.find((source) => source.kind === 'video');
  if (video) return video.id;
  const audio = audible.find((source) => source.kind === 'audio');
  return audio ? audio.id : null;
}
