export function TimelineFooter() {
  return (
    <footer className="shell-footer" aria-label="Timeline">
      <div className="shell-footer-header">
        <div>
          <h2 className="shell-footer-title">Timeline</h2>
          <p className="shell-footer-copy">Split, delete, and save are available in the Studio editor below.</p>
        </div>
        <div className="shell-footer-actions" role="group" aria-label="Timeline actions preview">
          <button className="shell-timeline-button" type="button" disabled>Split</button>
          <button className="shell-timeline-button" type="button" disabled>Delete</button>
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
