import type { Ms } from './ms.ts';
import { msToSeconds, secondsToMs } from './ms.ts';
import type { Rect } from './effects.ts';
import { EffectStack, normalizeRect } from './effects.ts';
import { constant, evaluate } from './animatable.ts';
import type { SourceId } from './clip.ts';
import { Clip, MIN_CLIP_DURATION } from './clip.ts';
import { Track } from './track.ts';
import { Timeline } from './timeline.ts';
import type { Source } from './source.ts';
import { makeSource } from './source.ts';
import type { ProjectJson } from './project.ts';
import { PROJECT_SCHEMA_VERSION, Project } from './project.ts';
import { invariant } from './invariant.ts';

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

function sourcesForTake(durationsSeconds: StemDurations): Source[] {
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
  return sources;
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
  const sources = sourcesForTake(durationsSeconds);
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
  const project = new Project({ timeline });
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
      out: msToSeconds(clip.sourceOut),
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
    clips,
    updatedAt: doc.updatedAt,
  };
}
