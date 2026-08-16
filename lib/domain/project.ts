import type { Track } from './track.ts';
import type { TimelineJson } from './timeline.ts';
import { Timeline } from './timeline.ts';
import type { AudioRoute } from './source.ts';
import { resolveAudioRoute } from './source.ts';
import type { OutputTarget } from './output-target.ts';
import { makeOutputTarget } from './output-target.ts';
import { invariant } from './invariant.ts';

export const PROJECT_SCHEMA_VERSION = 2;

export type ProjectJson = {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  timeline: TimelineJson;
  outputs: OutputTarget[];
  audioRoute: AudioRoute;
  updatedAt?: string;
};

export class Project {
  readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  readonly timeline: Timeline;
  readonly outputs: OutputTarget[];
  audioRoute: AudioRoute;

  constructor(init: { timeline?: Timeline; outputs?: OutputTarget[]; audioRoute?: AudioRoute } = {}) {
    this.schemaVersion = PROJECT_SCHEMA_VERSION;
    this.timeline = init.timeline ?? new Timeline();
    this.outputs = [];
    this.audioRoute = init.audioRoute ?? { activeSourceId: null, resolvedBy: 'auto' };
    for (const output of init.outputs ?? []) this.addOutput(output);
  }

  get tracks(): Track[] {
    return this.timeline.tracks;
  }

  get enabledOutputs(): OutputTarget[] {
    return this.outputs.filter((output) => output.enabled);
  }

  addOutput(output: OutputTarget): OutputTarget {
    invariant(
      !this.outputs.some((existing) => existing.id === output.id),
      'DUPLICATE_OUTPUT_ID',
      output.id,
    );
    this.outputs.push(output);
    return output;
  }

  removeOutput(outputId: string): OutputTarget {
    const index = this.outputs.findIndex((output) => output.id === outputId);
    invariant(index >= 0, 'OUTPUT_NOT_FOUND', outputId);
    return this.outputs.splice(index, 1)[0] as OutputTarget;
  }

  output(outputId: string): OutputTarget {
    const found = this.outputs.find((candidate) => candidate.id === outputId);
    invariant(found, 'OUTPUT_NOT_FOUND', outputId);
    return found as OutputTarget;
  }

  normalize(): void {
    this.timeline.normalize();
    const active = this.audioRoute.activeSourceId;
    const stillValid =
      active != null &&
      this.timeline.sources.has(active) &&
      this.timeline.source(active).hasAudio &&
      this.timeline.source(active).present;
    if (!stillValid) {
      this.audioRoute = {
        activeSourceId: resolveAudioRoute(this.timeline.sources.values()),
        resolvedBy: 'auto',
      };
    }
  }

  toJSON(): ProjectJson {
    return {
      schemaVersion: this.schemaVersion,
      timeline: this.timeline.toJSON(),
      outputs: this.outputs,
      audioRoute: this.audioRoute,
    };
  }

  static fromJSON(json: ProjectJson): Project {
    invariant(json.schemaVersion === PROJECT_SCHEMA_VERSION, 'SCHEMA_VERSION_UNSUPPORTED', String(json.schemaVersion));
    const project = new Project({
      timeline: Timeline.fromJSON(json.timeline),
      outputs: (json.outputs ?? []).map((output) => makeOutputTarget(output)),
      audioRoute: json.audioRoute,
    });
    project.normalize();
    return project;
  }
}
