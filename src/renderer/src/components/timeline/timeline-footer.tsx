import { useEffect, useRef, useState } from 'react';

import {
  canDispatchCommand,
  dispatchCommand,
  onCommandAvailabilityChange,
} from '../../shortcuts/command-bus.ts';
import { TimelinePanel } from './timeline-panel.tsx';
import {
  MIN_TIMELINE_DOCK_HEIGHT,
  clampTimelineDockHeightForViewport,
  keyboardTimelineDockHeight,
  timelineDockHeightValueText,
  timelineDockMaxHeight,
  timelineProjectLabel,
  type TimelineProjectState,
} from './use-timeline-project.ts';

type ActiveTimelineCommand = 'timeline:split' | 'timeline:delete-ripple';
type CommandAvailabilityState = Record<ActiveTimelineCommand, boolean>;
const DEFAULT_DOCK_HEIGHT = 260;

function readTimelineCommandAvailability(): CommandAvailabilityState {
  return {
    'timeline:split': canDispatchCommand('timeline:split'),
    'timeline:delete-ripple': canDispatchCommand('timeline:delete-ripple'),
  };
}

function maxDockHeight(): number {
  return timelineDockMaxHeight(window.innerHeight);
}

function clampDockHeight(height: number): number {
  return clampTimelineDockHeightForViewport(height, window.innerHeight);
}

export function TimelineFooter({ timelineProject }: { timelineProject: TimelineProjectState }) {
  const [commandAvailability, setCommandAvailability] = useState(readTimelineCommandAvailability);
  const [dockHeight, setDockHeight] = useState(() => clampDockHeight(DEFAULT_DOCK_HEIGHT));
  const dragStart = useRef<{ pointerY: number; height: number } | null>(null);
  const dockMax = maxDockHeight();

  useEffect(() => {
    const refreshAvailability = () => setCommandAvailability(readTimelineCommandAvailability());
    refreshAvailability();
    return onCommandAvailabilityChange(refreshAvailability);
  }, []);

  useEffect(() => {
    const clampToViewport = () => setDockHeight((height) => clampDockHeight(height));
    window.addEventListener('resize', clampToViewport);
    return () => window.removeEventListener('resize', clampToViewport);
  }, []);

  function startResize(event: React.PointerEvent<HTMLDivElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { pointerY: event.clientY, height: dockHeight };
  }

  function resize(event: React.PointerEvent<HTMLDivElement>): void {
    if (!dragStart.current) return;
    const delta = dragStart.current.pointerY - event.clientY;
    setDockHeight(clampDockHeight(dragStart.current.height + delta));
  }

  function stopResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStart.current = null;
  }

  function resizeWithKeyboard(event: React.KeyboardEvent<HTMLDivElement>): void {
    const nextHeight = keyboardTimelineDockHeight(dockHeight, event.key, window.innerHeight);
    if (nextHeight === null) return;
    event.preventDefault();
    setDockHeight((height) => keyboardTimelineDockHeight(height, event.key, window.innerHeight) ?? height);
  }

  return (
    <footer className="shell-footer" aria-label="Timeline" style={{ height: `${dockHeight}px` }}>
      <div
        className="shell-footer-resize"
        role="separator"
        aria-label="Resize timeline"
        aria-orientation="horizontal"
        aria-valuemin={MIN_TIMELINE_DOCK_HEIGHT}
        aria-valuemax={dockMax}
        aria-valuenow={dockHeight}
        aria-valuetext={timelineDockHeightValueText(dockHeight)}
        tabIndex={0}
        onPointerDown={startResize}
        onPointerMove={resize}
        onPointerUp={stopResize}
        onPointerCancel={stopResize}
        onKeyDown={resizeWithKeyboard}
      />
      <div className="shell-footer-header">
        <div>
          <h2 className="shell-footer-title">Timeline</h2>
          <p className="shell-footer-copy">{timelineProjectLabel(timelineProject)}</p>
        </div>
        <div className="shell-footer-actions" role="group" aria-label="Timeline actions">
          <button
            className="shell-timeline-button"
            type="button"
            disabled={!commandAvailability['timeline:split']}
            onClick={() => dispatchCommand('timeline:split')}
          >
            Split
          </button>
          <button
            className="shell-timeline-button"
            type="button"
            disabled={!commandAvailability['timeline:delete-ripple']}
            onClick={() => dispatchCommand('timeline:delete-ripple')}
          >
            Delete
          </button>
          <button className="shell-timeline-button" type="button" disabled>Save in Studio editor</button>
        </div>
      </div>
      <TimelinePanel state={timelineProject} />
    </footer>
  );
}
