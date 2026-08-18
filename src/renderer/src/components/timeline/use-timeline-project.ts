import { useEffect, useState } from 'react';

import { Project, type ProjectJson } from '../../../../../lib/domain/project.ts';

type ListedTake = {
  id: string;
};

type LoadedTakeProject = {
  takeId: string;
  missingSources: string[];
  project: ProjectJson;
};

export const TIMELINE_ERROR_MESSAGE = 'Timeline data is unavailable. Reopen the current take and try again.';
export const MIN_TIMELINE_DOCK_HEIGHT = 180;
export const TIMELINE_DOCK_KEYBOARD_STEP = 16;
const MAX_DOCK_VIEWPORT_FRACTION = 0.65;

export type TimelineProjectState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | {
      status: 'ready' | 'missing-source';
      takeId: string;
      loadedProject: LoadedTakeProject;
      project: Project;
    };

export function timelineErrorMessage(): string {
  return TIMELINE_ERROR_MESSAGE;
}

function isListedTake(candidate: unknown): candidate is ListedTake {
  return (
    typeof candidate === 'object'
    && candidate !== null
    && typeof (candidate as { id?: unknown }).id === 'string'
    && (candidate as { id: string }).id.length > 0
  );
}

export function loadedTakeProject(value: unknown): LoadedTakeProject {
  if (typeof value !== 'object' || value === null) {
    throw new Error('loadProject returned an invalid payload');
  }
  const payload = value as Partial<LoadedTakeProject>;
  if (typeof payload.takeId !== 'string' || !payload.takeId) {
    throw new Error('loadProject payload is missing takeId');
  }
  if (!Array.isArray(payload.missingSources)) {
    throw new Error('loadProject payload is missing missingSources');
  }
  if (typeof payload.project !== 'object' || payload.project === null) {
    throw new Error('loadProject payload is missing project');
  }
  return {
    takeId: payload.takeId,
    missingSources: payload.missingSources.map((source) => String(source)),
    project: payload.project,
  };
}

export function loadedTimelineStatus(
  loaded: Pick<LoadedTakeProject, 'missingSources'>,
): 'ready' | 'missing-source' {
  return loaded.missingSources.length > 0 ? 'missing-source' : 'ready';
}

export function hydrateLoadedTimelineProject(
  loaded: LoadedTakeProject,
): Extract<TimelineProjectState, { status: 'ready' | 'missing-source' }> {
  const project = Project.fromJSON(loaded.project);
  return {
    status: loadedTimelineStatus(loaded),
    takeId: loaded.takeId,
    loadedProject: loaded,
    project,
  };
}

export function timelineDockMaxHeight(viewportHeight: number): number {
  const viewportMax = Math.floor(viewportHeight * MAX_DOCK_VIEWPORT_FRACTION);
  return Math.max(MIN_TIMELINE_DOCK_HEIGHT, viewportMax);
}

export function clampTimelineDockHeightForViewport(height: number, viewportHeight: number): number {
  return Math.min(Math.max(height, MIN_TIMELINE_DOCK_HEIGHT), timelineDockMaxHeight(viewportHeight));
}

export function keyboardTimelineDockHeight(
  height: number,
  key: string,
  viewportHeight: number,
): number | null {
  switch (key) {
    case 'ArrowUp':
      return clampTimelineDockHeightForViewport(height + TIMELINE_DOCK_KEYBOARD_STEP, viewportHeight);
    case 'ArrowDown':
      return clampTimelineDockHeightForViewport(height - TIMELINE_DOCK_KEYBOARD_STEP, viewportHeight);
    case 'Home':
      return MIN_TIMELINE_DOCK_HEIGHT;
    case 'End':
      return timelineDockMaxHeight(viewportHeight);
    default:
      return null;
  }
}

export function timelineDockHeightValueText(height: number): string {
  return `${height} pixels`;
}

export function timelineProjectLabel(state: TimelineProjectState): string {
  if (state.status === 'ready' || state.status === 'missing-source') {
    return state.project.timeline.takeId || state.takeId;
  }
  if (state.status === 'loading') return 'Loading';
  if (state.status === 'empty') return 'No take';
  return 'Timeline unavailable';
}

export function useTimelineProject(): TimelineProjectState {
  const [state, setState] = useState<TimelineProjectState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function loadLatestTakeProject(): Promise<void> {
      const studio = window.stemStudio;
      if (!studio) {
        setState({ status: 'error', message: timelineErrorMessage() });
        return;
      }

      setState({ status: 'loading' });

      try {
        const listed = await studio.listTakes();
        const takes = Array.isArray(listed) ? listed.filter(isListedTake) : [];
        const take = takes[0];
        if (!take) {
          if (!cancelled) setState({ status: 'empty' });
          return;
        }

        const loaded = loadedTakeProject(await studio.loadProject(take.id));
        if (!cancelled) {
          setState(hydrateLoadedTimelineProject(loaded));
        }
      } catch (error) {
        if (!cancelled) setState({ status: 'error', message: timelineErrorMessage() });
      }
    }

    void loadLatestTakeProject();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
