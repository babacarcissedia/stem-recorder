import { IconButton } from '../atoms/icon-button.tsx';

export function PlayerTransport({ current, total }: { current: string; total: string }) {
  return (
    <div className="shell-player-transport" role="toolbar" aria-label="Transport">
      <IconButton label="▶" disabled />
      <span className="shell-player-time">
        {current} / {total}
      </span>
      <div className="shell-player-transport-spacer" />
      <IconButton label="Fit" disabled />
      <IconButton label="Ratio" disabled />
      <IconButton label="⤢" disabled />
    </div>
  );
}
