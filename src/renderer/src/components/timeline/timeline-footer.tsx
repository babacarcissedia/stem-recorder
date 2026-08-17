import { useEffect, useState } from 'react';

import {
  canDispatchCommand,
  dispatchCommand,
  onCommandAvailabilityChange,
} from '../../shortcuts/command-bus.ts';

type ActiveTimelineCommand = 'timeline:split' | 'timeline:delete-ripple';
type CommandAvailabilityState = Record<ActiveTimelineCommand, boolean>;

function readTimelineCommandAvailability(): CommandAvailabilityState {
  return {
    'timeline:split': canDispatchCommand('timeline:split'),
    'timeline:delete-ripple': canDispatchCommand('timeline:delete-ripple'),
  };
}

export function TimelineFooter() {
  const [commandAvailability, setCommandAvailability] = useState(readTimelineCommandAvailability);

  useEffect(() => {
    const refreshAvailability = () => setCommandAvailability(readTimelineCommandAvailability());
    refreshAvailability();
    return onCommandAvailabilityChange(refreshAvailability);
  }, []);

  return (
    <footer className="shell-footer" aria-label="Timeline">
      <div className="shell-footer-header">
        <div>
          <h2 className="shell-footer-title">Timeline</h2>
          <p className="shell-footer-copy">Split and delete run on the open Studio edit. Save remains in the Studio editor below.</p>
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
          <button className="shell-timeline-button" type="button" disabled>Save</button>
        </div>
      </div>
      <div className="shell-timeline-preview" aria-hidden="true">
        <div className="shell-timeline-ruler">
          <span>0:00</span>
          <span>0:15</span>
          <span>0:30</span>
        </div>
        <div className="shell-timeline-lane">
          <span className="shell-timeline-lane-label">Video 1</span>
          <span className="shell-timeline-clip">Current take</span>
          <span className="shell-timeline-playhead" />
        </div>
      </div>
    </footer>
  );
}
