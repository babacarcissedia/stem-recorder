import type { ReactNode } from 'react';

export function ShellLayout({
  leftSidebar,
  main,
  rightSidebar,
  footer,
}: {
  leftSidebar: ReactNode;
  main: ReactNode;
  rightSidebar: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="shell-body">
      {leftSidebar}
      {main}
      {rightSidebar}
      {footer}
    </div>
  );
}
