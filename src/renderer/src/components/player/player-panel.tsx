import { PlayerTransport } from './player-transport.tsx';

export function PlayerPanel() {
  return (
    <section className="shell-main" aria-label="Preview">
      <div className="shell-player-stage">
        <p className="shell-player-stage-empty">No take open.</p>
      </div>
      <PlayerTransport current="0:00" total="0:00" />
    </section>
  );
}
