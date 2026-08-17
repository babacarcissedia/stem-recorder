import { IconButton } from '../atoms/icon-button.tsx';

export function TopBar({ projectName, autoSavedAt }: { projectName: string; autoSavedAt: string | null }) {
  return (
    <header className="shell-top-bar">
      <div className="shell-top-bar-identity">
        <span className="shell-top-bar-project">{projectName}</span>
        <span className="shell-top-bar-autosave">
          {autoSavedAt ? `Auto saved: ${autoSavedAt}` : 'Not saved yet'}
        </span>
      </div>
      <IconButton label="⌨" disabled />
    </header>
  );
}
