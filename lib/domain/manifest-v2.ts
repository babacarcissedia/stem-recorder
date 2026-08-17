import type { Ms } from './ms.ts';
import { msToSeconds, secondsToMs } from './ms.ts';
import type { Rect } from './effects.ts';
import { EffectStack, normalizeRect } from './effects.ts';
import { constant, evaluate } from './animatable.ts';
import type { SourceId } from './clip.ts';
import { Clip, MIN_CLIP_DURATION } from './clip.ts';
import { Track } from './track.ts';
import { Timeline } from './timeline.ts';
import type { AudioRoute, Source, SourceKind, SourceOrigin } from './source.ts';
import { makeSource, resolveAudioRoute } from './source.ts';
import type { ProjectJson } from './project.ts';
import { PROJECT_SCHEMA_VERSION, Project } from './project.ts';
import { InvariantError, invariant } from './invariant.ts';

export const MANIFEST_SCHEMA_VERSION = PROJECT_SCHEMA_VERSION;

export const V1_STEMS = [
  { file: 'cam.mp4', sourceId: 'src-cam', kind: 'video', hasAudio: true },
  { file: 'screen.mp4', sourceId: 'src-screen', kind: 'video', hasAudio: false },
  { file: 'audio.mp3', sourceId: 'src-audio', kind: 'audio', hasAudio: true },
] as const;

export const V1_VIDEO_TRACK_ID = 'track-video';

export type V1Clip = {
  id: string;
  source: string;
  in: number;
  out: number | null;
  crop?: Rect | null;
  freeze?: boolean;
};

export type V1Manifest = {
  version: 1;
  takeId: string;
  source: string;
  clips: V1Clip[];
  cam?: unknown;
  captions?: unknown;
  exportRate?: unknown;
  music?: unknown;
  vertical?: boolean;
  audioRoute?: AudioRoute;
  compatAudioSources?: Source[];
  updatedAt: string;
};

export type ManifestSettings = {
  source: string;
  cam?: unknown;
  captions?: unknown;
  exportRate?: unknown;
  music?: unknown;
  vertical?: boolean;
};

export type ManifestV2 = {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  takeId: string;
  project: ProjectJson;
  settings: ManifestSettings;
  updatedAt: string;
};

export type StemDurations = Partial<Record<string, number | null>>;

export function detectSchemaVersion(doc: unknown): number {
  if (!doc || typeof doc !== 'object') return 0;
  const raw = doc as Record<string, unknown>;
  if (typeof raw.schemaVersion === 'number') return raw.schemaVersion;
  if (typeof raw.version === 'number') return raw.version;
  return 0;
}

function settingsFrom(doc: Partial<V1Manifest>): ManifestSettings {
  const settings: ManifestSettings = { source: doc.source || 'screen.mp4' };
  if (doc.cam != null) settings.cam = doc.cam;
  if (doc.captions != null) settings.captions = doc.captions;
  if (doc.exportRate != null) settings.exportRate = doc.exportRate;
  if (doc.music != null) settings.music = doc.music;
  if (doc.vertical === true) settings.vertical = true;
  return settings;
}

function requiredCompatString(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new InvariantError(code);
  return value;
}

function takeLocalSourcePath(value: unknown): string {
  const sourcePath = requiredCompatString(value, 'COMPAT_AUDIO_SOURCE_PATH_REQUIRED');
  invariant(
    !sourcePath.includes('\0')
      && !sourcePath.startsWith('/')
      && !sourcePath.startsWith('\\')
      && !/^[A-Za-z]:[\\/]/.test(sourcePath)
      && sourcePath.split('/').every((segment) => segment !== '..')
      && !sourcePath.includes('\\'),
    'COMPAT_AUDIO_SOURCE_PATH_NOT_TAKE_LOCAL',
  );
  return sourcePath;
}

function compatAudioSource(value: unknown): Source {
  invariant(value != null && typeof value === 'object' && !Array.isArray(value), 'INVALID_COMPAT_AUDIO_SOURCE');
  const source = value as Record<string, unknown>;
  const kind = requiredCompatString(source.kind, 'COMPAT_AUDIO_SOURCE_KIND_REQUIRED');
  invariant(kind === 'audio' || kind === 'video', 'COMPAT_AUDIO_SOURCE_NOT_AUDIBLE');
  const origin = requiredCompatString(source.origin, 'COMPAT_AUDIO_SOURCE_ORIGIN_REQUIRED');
  invariant(['capture', 'import', 'generated'].includes(origin), 'COMPAT_AUDIO_SOURCE_ORIGIN_INVALID');
  invariant(typeof source.hasAudio === 'boolean', 'COMPAT_AUDIO_SOURCE_NOT_AUDIBLE');
  invariant(typeof source.present === 'boolean', 'COMPAT_AUDIO_SOURCE_PRESENT_INVALID');
  invariant(
    typeof source.availableDuration === 'number'
      && Number.isFinite(source.availableDuration)
      && Number.isInteger(source.availableDuration)
      && source.availableDuration >= 0,
    'COMPAT_AUDIO_SOURCE_DURATION_INVALID',
  );
  invariant(source.peaksKey === null || typeof source.peaksKey === 'string', 'COMPAT_AUDIO_SOURCE_PEAKS_KEY_INVALID');

  return makeSource({
    id: requiredCompatString(source.id, 'COMPAT_AUDIO_SOURCE_ID_REQUIRED'),
    path: takeLocalSourcePath(source.path),
    label: requiredCompatString(source.label, 'COMPAT_AUDIO_SOURCE_LABEL_REQUIRED'),
    kind: kind as SourceKind,
    availableDuration: source.availableDuration as number,
    hasAudio: source.hasAudio as boolean,
    present: source.present as boolean,
    origin: origin as SourceOrigin,
    peaksKey: source.peaksKey as string | null,
  });
}

function compatAudioSources(doc: V1Manifest): Source[] {
  const raw: unknown = doc.compatAudioSources;
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new InvariantError('COMPAT_AUDIO_SOURCES_INVALID');
  const sourceIds = new Set<string>();
  return raw.map((value) => {
    const source = compatAudioSource(value);
    invariant(!sourceIds.has(source.id), 'DUPLICATE_COMPAT_AUDIO_SOURCE', source.id);
    sourceIds.add(source.id);
    return source;
  });
}

function isReservedV1SourceId(sourceId: SourceId): boolean {
  return V1_STEMS.some((stem) => stem.sourceId === sourceId);
}

function matchesCanonicalSource(source: Source, canonical: Source): boolean {
  return source.id === canonical.id
    && source.path === canonical.path
    && source.label === canonical.label
    && source.kind === canonical.kind
    && source.availableDuration === canonical.availableDuration
    && source.hasAudio === canonical.hasAudio
    && source.present === canonical.present
    && source.origin === canonical.origin
    && source.peaksKey === canonical.peaksKey;
}

function sourcesForTake(durationsSeconds: StemDurations, compatibleSources: Source[] = []): Source[] {
  const sources: Source[] = [];
  for (const stem of V1_STEMS) {
    const seconds = durationsSeconds[stem.file];
    if (seconds == null) continue;
    sources.push(
      makeSource({
        id: stem.sourceId,
        path: stem.file,
        label: stem.file,
        kind: stem.kind,
        availableDuration: secondsToMs(seconds),
        hasAudio: stem.hasAudio,
        origin: 'capture',
      }),
    );
  }
  for (const source of compatibleSources) {
    const canonical = sources.find((candidate) => candidate.id === source.id);
    if (isReservedV1SourceId(source.id)) {
      invariant(canonical && matchesCanonicalSource(source, canonical), 'COMPAT_AUDIO_SOURCE_ID_CONFLICT', source.id);
      continue;
    }
    invariant(source.hasAudio, 'COMPAT_AUDIO_SOURCE_NOT_AUDIBLE');
    sources.push(source);
  }
  return sources;
}

export function resolveLegacyDialogueSource(durationsSeconds: StemDurations): string | null {
  const sources = sourcesForTake(durationsSeconds);
  const sourceId = resolveAudioRoute(sources);
  return sourceId == null ? null : sources.find((source) => source.id === sourceId)?.path ?? null;
}

function sourceIdForFile(file: string): SourceId {
  const stem = V1_STEMS.find((candidate) => candidate.file === file);
  invariant(stem, 'UNKNOWN_V1_STEM', file);
  return (stem as (typeof V1_STEMS)[number]).sourceId;
}

function fileForSourceId(timeline: Timeline, sourceId: SourceId): string {
  return timeline.source(sourceId).path;
}

export function migrateV1ToV2(doc: V1Manifest, durationsSeconds: StemDurations): ManifestV2 {
  invariant(detectSchemaVersion(doc) === 1, 'NOT_A_V1_MANIFEST', String(detectSchemaVersion(doc)));
  const sources = sourcesForTake(durationsSeconds, compatAudioSources(doc));
  const timeline = new Timeline({ takeId: doc.takeId, sources });
  const track = new Track({ id: V1_VIDEO_TRACK_ID, kind: 'video', name: 'Video' });

  let timelineStart: Ms = 0;
  for (const [index, v1clip] of (doc.clips ?? []).entries()) {
    const file = v1clip.source || doc.source || 'screen.mp4';
    const sourceId = sourceIdForFile(file);
    const available = timeline.sources.has(sourceId)
      ? timeline.source(sourceId).availableDuration
      : 0;
    const sourceIn = secondsToMs(Number(v1clip.in ?? 0));
    const sourceOut = v1clip.out == null ? available : secondsToMs(Number(v1clip.out));
    const isFreeze = v1clip.freeze === true;
    const span = sourceOut - sourceIn;
    const duration = isFreeze ? Math.max(span, MIN_CLIP_DURATION) : span;
    const effects: EffectStack = new EffectStack([
      ...(isFreeze
        ? [{ id: `fx-freeze-${index}`, type: 'freeze' as const, enabled: true, params: {} }]
        : []),
      ...(normalizeRect(v1clip.crop)
        ? [
            {
              id: `fx-crop-${index}`,
              type: 'crop' as const,
              enabled: true,
              params: { rect: constant(normalizeRect(v1clip.crop) as Rect) },
            },
          ]
        : []),
    ]);
    track.insert(
      new Clip({
        id: v1clip.id || `clip-${index + 1}`,
        sourceId,
        timelineStart,
        duration,
        sourceIn,
        effects,
      }),
    );
    timelineStart += duration;
  }

  timeline.addTrack(track);
  const project = new Project({ timeline, audioRoute: doc.audioRoute });
  project.normalize();

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    takeId: doc.takeId,
    project: project.toJSON(),
    settings: settingsFrom(doc),
    updatedAt: doc.updatedAt || new Date().toISOString(),
  };
}

export function readManifestV2(doc: ManifestV2): { project: Project; settings: ManifestSettings } {
  invariant(
    detectSchemaVersion(doc) === MANIFEST_SCHEMA_VERSION,
    'SCHEMA_VERSION_UNSUPPORTED',
    String(detectSchemaVersion(doc)),
  );
  return { project: Project.fromJSON(doc.project), settings: doc.settings };
}

export function resolveDialogueSource(doc: ManifestV2): string | null {
  const { project } = readManifestV2(doc);
  const sourceId = project.audioRoute.resolvedBy === 'user'
    ? project.audioRoute.activeSourceId
    : resolveAudioRoute(project.timeline.sources.values());
  if (sourceId == null || !project.timeline.sources.has(sourceId)) return null;
  const source = project.timeline.source(sourceId);
  return source.hasAudio && source.present ? source.path : null;
}

export function toManifestV2(
  takeId: string,
  project: Project,
  settings: ManifestSettings,
  updatedAt = new Date().toISOString(),
): ManifestV2 {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    takeId,
    project: project.toJSON(),
    settings,
    updatedAt,
  };
}

export function toV1Compat(doc: ManifestV2): V1Manifest {
  const { project, settings } = readManifestV2(doc);
  const compatibleAudioSources = [...project.timeline.sources.values()].filter((source) => source.hasAudio);
  const track = project.timeline.tracks.find((candidate) => candidate.id === V1_VIDEO_TRACK_ID)
    ?? project.timeline.tracks[0];
  const clips: V1Clip[] = [];
  for (const clip of track ? track.clips : []) {
    const crop = clip.effects.enabledEffects.find((effect) => effect.type === 'crop');
    const rect = crop && crop.type === 'crop' ? evaluate(crop.params.rect, 0) : null;
    clips.push({
      id: clip.id,
      source: fileForSourceId(project.timeline, clip.sourceId),
      in: msToSeconds(clip.sourceIn),
      out: msToSeconds(clip.effects.isFreeze ? clip.sourceIn + clip.duration : clip.sourceOut),
      ...(rect ? { crop: rect } : {}),
      ...(clip.effects.isFreeze ? { freeze: true } : {}),
    });
  }
  return {
    version: 1,
    takeId: doc.takeId,
    source: settings.source,
    ...(settings.cam != null ? { cam: settings.cam } : {}),
    ...(settings.captions != null ? { captions: settings.captions } : {}),
    ...(settings.exportRate != null ? { exportRate: settings.exportRate } : {}),
    ...(settings.music != null ? { music: settings.music } : {}),
    ...(settings.vertical === true ? { vertical: true } : {}),
    audioRoute: project.audioRoute,
    ...(compatibleAudioSources.length > 0 ? { compatAudioSources: compatibleAudioSources } : {}),
    clips,
    updatedAt: doc.updatedAt,
  };
}
