export function TimelinePlayhead({ at, duration }: { at: number; duration: number }) {
  return (
    <div
      className="react-timeline-playhead"
      aria-hidden="true"
      style={{ insetInlineStart: `${duration > 0 ? (at / duration) * 100 : 0}%` }}
    />
  );
}
