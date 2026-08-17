#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  SHORTCUT_REGISTRY,
  parseAccelerator,
  chordFromKeyEvent,
  chordsEqual,
  findBindingForChord,
  isTypingTarget,
} = require('../lib/domain/shortcuts.ts');
const { THEME_PREFERENCES, themeCommandId } = require('../lib/domain/theme.ts');
const { MENU_COMMANDS } = require('../src/preload/api.ts');
const { onCommand, dispatchCommand } = require('../src/renderer/src/shortcuts/command-bus.ts');

const KEYBOARD_COMMAND_IDS = [
  'file:new-take',
  'file:open-take-folder',
  'file:export-bundle',
  'timeline:split',
  'timeline:delete-ripple',
  'timeline:mark-in',
  'timeline:mark-out',
  'timeline:play-pause',
];

let cases = 0;
function check(condition, message) {
  cases += 1;
  assert.ok(condition, message);
}

{
  const bound = SHORTCUT_REGISTRY.filter((binding) => binding.accelerator !== undefined);
  const chords = bound.map((binding) => parseAccelerator(binding.accelerator));
  for (let i = 0; i < chords.length; i += 1) {
    for (let j = i + 1; j < chords.length; j += 1) {
      check(
        !chordsEqual(chords[i], chords[j]),
        `'${bound[i].id}' and '${bound[j].id}' share accelerator '${bound[i].accelerator}'`
      );
    }
  }
}

{
  const menuSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'menu.ts'), 'utf8');
  const studioSourcePath = process.env.STUDIO_SHORTCUTS_SOURCE_PATH
    || path.join(__dirname, '..', 'src', 'renderer', 'src', 'studio.ts');
  const studioSource = fs.readFileSync(studioSourcePath, 'utf8');
  const studioUiStart = studioSource.indexOf('window.mountLegacyStudio = function mountLegacyStudio() {');
  check(studioUiStart >= 0, 'studio registers the named LegacyStudioHost lifecycle');

  const studioUiEnd = studioSource.lastIndexOf('\n};');
  check(studioUiEnd > studioUiStart, 'mountLegacyStudio has a closing boundary');

  const studioUiSource = studioSource.slice(studioUiStart, studioUiEnd + '\n};'.length);
  const referencedIds = new Set([...menuSource.matchAll(/commandItem\('([^']+)'/g)].map((match) => match[1]));
  if (/commandItem\(themeCommandId\(preference\)/.test(menuSource)) {
    for (const preference of THEME_PREFERENCES) referencedIds.add(themeCommandId(preference));
  }
  const liveHandlerStart = studioUiSource.indexOf('const liveCommandHandlers');
  const liveHandlerSource = studioUiSource.slice(liveHandlerStart);
  const liveHandlerIds = new Set([...liveHandlerSource.matchAll(/'([^']+)':\s*\(\)\s*=>/g)].map((match) => match[1]));
  const commandSubscriptionCalls = studioUiSource.match(/\bonCommand\s*\(/g) ?? [];
  const keyboardSubscriptionCalls = studioUiSource.match(/\bsubscribeKeyboardShortcuts\s*\(/g) ?? [];
  const unloadCleanup = studioUiSource.match(
    /window\.addEventListener\(\s*['"]beforeunload['"]\s*,\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*\{\s*once\s*:\s*true\s*\}\s*\);/
  );

  check(liveHandlerStart >= 0, 'studioUi mounts live command handlers');
  check(
    commandSubscriptionCalls.length === 1
      && /\bconst\s+unsubscribeCommands\s*=\s*onCommand\s*\(\s*\(command\)\s*=>\s*liveCommandHandlers\[command\]\(\)\s*,/.test(studioUiSource),
    'studioUi registers its live command-bus consumer'
  );
  check(
    keyboardSubscriptionCalls.length === 1
      && /\bconst\s+unsubscribeKeyboardShortcuts\s*=\s*subscribeKeyboardShortcuts\s*\(\s*\)\s*;/.test(studioUiSource),
    'studioUi registers exactly one keyboard-shortcut subscription'
  );
  check(
    unloadCleanup === null,
    'legacy Studio leaves shortcut/menu cleanup to the React shell lifecycle'
  );
  check(
    /let\s+cleanedUp\s*=\s*false\s*;[\s\S]*return\s*\(\)\s*=>\s*\{\s*\n\s*if\s*\(\s*cleanedUp\s*\)\s*return\s*;\s*\n\s*cleanedUp\s*=\s*true\s*;\s*\n\s*unsubscribeKeyboardShortcuts\s*\(\s*\)\s*;\s*\n\s*unsubscribeCommands\s*\(\s*\)\s*;\s*\n\s*\}\s*;/.test(studioUiSource),
    'legacy Studio exposes idempotent shortcut/menu cleanup to AppShell'
  );
  check(
    studioUiSource.includes("command === 'file:new-take' || hasActiveEditableManifest()"),
    'studio keeps editor commands unavailable without an editable manifest'
  );

  for (const binding of SHORTCUT_REGISTRY) {
    check(referencedIds.has(binding.id), `registry entry '${binding.id}' is never referenced by a commandItem() call in menu.ts`);
  }
  for (const id of MENU_COMMANDS) {
    check(liveHandlerIds.has(id), `preload command '${id}' has no live Studio handler`);
    check(
      SHORTCUT_REGISTRY.some((binding) => binding.id === id),
      `preload accepts '${id}' but no SHORTCUT_REGISTRY entry has that id`
    );
  }
  for (const id of referencedIds) {
    check(
      SHORTCUT_REGISTRY.some((binding) => binding.id === id),
      `menu.ts calls commandItem('${id}') but no SHORTCUT_REGISTRY entry has that id`
    );
  }
  check(
    JSON.stringify(SHORTCUT_REGISTRY.filter((binding) => binding.accelerator !== undefined).map((binding) => binding.id))
      === JSON.stringify(KEYBOARD_COMMAND_IDS),
    'registry contains only live Studio commands on the keyboard path'
  );

  const rendererMainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'main.tsx'), 'utf8');
  const appShellSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'app-shell.tsx'), 'utf8');
  const legacyEditorIslandSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'src', 'components', 'legacy', 'legacy-editor-island.tsx'),
    'utf8'
  );
  const indexHtmlSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const recorderPanelSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'recorder-panel.ts'), 'utf8');
  const mountedRendererRoots = rendererMainSource.match(/\bcreateRoot\s*\(/g) ?? [];
  const legacyRegistrationImports = rendererMainSource.match(/import\s+['"]\.\/(?:studio|recorder-panel)\.ts['"]\s*;/g) ?? [];
  const appShellDirectSubscriptions = appShellSource.match(/\b(?:useKeyboardShortcuts|subscribeKeyboardShortcuts)\s*\(|\bstemMenu\s*\??\.\s*onCommand\s*\(/g) ?? [];

  check(
    mountedRendererRoots.length === 1
      && /createRoot\(host\)\.render\(<AppShell\s*\/>\);/.test(rendererMainSource),
    'main mounts AppShell once as the live React renderer root'
  );
  check(
    /export\s+type\s+ShellView\s*=\s*\(typeof\s+SHELL_VIEWS\)\[number\]/.test(appShellSource)
      && /const\s+SHELL_VIEWS\s*=\s*\[\s*['"]studio['"]\s*,\s*['"]record['"]\s*,\s*['"]library['"]\s*\]\s+as\s+const\s*;/.test(appShellSource)
      && /const\s+DEFAULT_SHELL_VIEW\s*:\s*ShellView\s*=\s*['"]studio['"]/.test(appShellSource)
      && /useState\s*<\s*ShellView\s*>\s*\(\s*DEFAULT_SHELL_VIEW\s*\)/.test(appShellSource),
    'AppShell owns typed studio, record, and library shell view state with studio as the default route'
  );
  check(
    /import\s+\{\s*LegacyEditorIsland\s*\}\s+from\s+['"]\.\/components\/legacy\/legacy-editor-island\.tsx['"]/.test(appShellSource)
      && /function\s+StudioEditorChrome\s*\(/.test(appShellSource)
      && /function\s+renderShellView\s*\(\s*view\s*:\s*ShellView\s*\)/.test(appShellSource)
      && /case\s+['"]studio['"]\s*:\s*\n\s*return\s+<StudioEditorChrome\s*\/>;/.test(appShellSource)
      && /import\s+\{\s*ShellLayout\s*\}\s+from\s+['"]\.\/components\/layout\/shell-layout\.tsx['"]/.test(appShellSource)
      && /import\s+\{\s*TimelineFooter\s*\}\s+from\s+['"]\.\/components\/timeline\/timeline-footer\.tsx['"]/.test(appShellSource),
    'AppShell routes the default studio view through React editor chrome and LegacyEditorIsland'
  );
  check(
    /className=['"]shell-root['"][^>]*data-shell-view=\{shellView\}[^>]*aria-label=['"]Stem Studio['"]/.test(appShellSource)
      && /<nav\s+className=['"]shell-route-nav['"]\s+aria-label=['"]Workspaces['"]>/.test(appShellSource)
      && /<main\s+className=['"]shell-route['"]\s+data-shell-route=\{shellView\}\s+aria-label=\{routeLabel\(shellView\)\}>/.test(appShellSource)
      && /<section\s+className=['"]studio-editor-chrome['"]\s+aria-labelledby=['"]studio-editor-title['"]>/.test(appShellSource)
      && /<h1\s+id=['"]studio-editor-title['"]\s+className=['"]studio-editor-title['"]>Studio<\/h1>/.test(appShellSource)
      && /className=['"]studio-editor-status['"]\s+role=['"]status['"]\s+aria-label=['"]Studio status['"]/.test(appShellSource)
      && /className=['"]studio-editor-react-shell['"]\s+role=['"]region['"]\s+aria-label=['"]Studio preview['"]\s+disabled/.test(appShellSource)
      && /<TopBar\s+projectName=['"]Current take['"]\s+autoSavedAt=\{null\}\s*\/>/.test(appShellSource)
      && /<ShellLayout[\s\S]*leftSidebar=\{<MediaSidebar \/>\}[\s\S]*main=\{<PlayerPanel \/>\}[\s\S]*rightSidebar=\{<InspectorSidebar \/>\}[\s\S]*footer=\{<TimelineFooter \/>\}[\s\S]*\/>/.test(appShellSource)
      && /className=['"]studio-editor-compatibility-frame['"]\s+role=['"]region['"]\s+aria-label=['"]Studio editor['"]/.test(appShellSource)
      && /<LegacyEditorIsland\s*\/>/.test(appShellSource),
    'AppShell exposes labelled shell, route navigation, React editor chrome, route, and LegacyEditorIsland compatibility landmark'
  );
  check(
    /function\s+RecordShell\s*\([\s\S]*<section\s+className=['"]shell-surface shell-surface-record['"]\s+aria-labelledby=['"]record-shell-title['"][\s\S]*<h1\s+id=['"]record-shell-title['"]/.test(appShellSource)
      && /role=['"]region['"]\s+aria-label=['"]Record setup['"]/.test(appShellSource)
      && /function\s+LibraryShell\s*\([\s\S]*<section\s+className=['"]shell-surface shell-surface-library['"]\s+aria-labelledby=['"]library-shell-title['"][\s\S]*<h1\s+id=['"]library-shell-title['"]/.test(appShellSource)
      && /role=['"]region['"]\s+aria-label=['"]Library contents['"]/.test(appShellSource),
    'Record and Library routes render React-owned labelled shell surfaces'
  );
  check(
    /<button[\s\S]*type=['"]button['"][\s\S]*className=\{`shell-route-tab\$\{shellView === view \? ' active' : ''\}`\}[\s\S]*aria-pressed=\{shellView === view\}[\s\S]*aria-label=\{`Show \$\{routeLabel\(view\)\}`\}[\s\S]*onClick=\{\(\) => setShellView\(view\)\}/.test(appShellSource),
    'workspace route navigation is keyboard-accessible and labelled'
  );
  check(
    (appShellSource.match(/<LegacyEditorIsland\s*\/>/g) ?? []).length === 1
      && /function\s+StudioEditorChrome\s*\([\s\S]*<LegacyEditorIsland\s*\/>[\s\S]*\}\s*\n\s*function\s+RecordShell/.test(appShellSource)
      && /case\s+['"]studio['"]\s*:\s*\n\s*return\s+<StudioEditorChrome\s*\/>;/.test(appShellSource)
      && /case\s+['"]record['"]\s*:\s*\n\s*return\s+<RecordShell\s*\/>;/.test(appShellSource)
      && /case\s+['"]library['"]\s*:\s*\n\s*return\s+<LibraryShell\s*\/>;/.test(appShellSource),
    'AppShell has one Studio-only routed React chrome path wrapping LegacyEditorIsland'
  );
  const timelineFooterSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'components', 'timeline', 'timeline-footer.tsx'), 'utf8');
  check(
    /<footer\s+className=['"]shell-footer['"]\s+aria-label=['"]Timeline['"]>/.test(timelineFooterSource)
      && /Split, delete, and save are available in the Studio editor below\./.test(timelineFooterSource)
      && /className=['"]shell-footer-actions['"]\s+role=['"]group['"]\s+aria-label=['"]Timeline actions preview['"]/.test(timelineFooterSource)
      && /<button\s+className=['"]shell-timeline-button['"]\s+type=['"]button['"]\s+disabled>Split<\/button>/.test(timelineFooterSource)
      && /<button\s+className=['"]shell-timeline-button['"]\s+type=['"]button['"]\s+disabled>Delete<\/button>/.test(timelineFooterSource)
      && /<button\s+className=['"]shell-timeline-button['"]\s+type=['"]button['"]\s+disabled>Save<\/button>/.test(timelineFooterSource)
      && /className=['"]shell-timeline-lane-label['"]>Video 1<\/span>/.test(timelineFooterSource)
      && !/onClick=/.test(timelineFooterSource),
    'TimelineFooter exposes labelled, non-editing timeline chrome'
  );
  check(
    indexHtmlSource.indexOf('id="app-shell-root"') >= 0
      && indexHtmlSource.indexOf('id="legacy-studio-root"') > indexHtmlSource.indexOf('id="app-shell-root"'),
    'legacy Studio markup is available for AppShell to host after the React root'
  );
  check(
    /export\s+function\s+LegacyEditorIsland\s*\(/.test(legacyEditorIslandSource)
      && /const\s+parkedParent\s*=\s*legacyStudioRoot\.parentElement\s*\?\?\s*document\.body\s*;/.test(legacyEditorIslandSource)
      && /const\s+parkedBefore\s*=\s*legacyStudioRoot\.nextSibling\s*;/.test(legacyEditorIslandSource)
      && /host\.append\s*\(\s*legacyStudioRoot\s*\)\s*;/.test(legacyEditorIslandSource)
      && /legacyStudioWindow\.mountRecorderPanel\s*\(\s*\)\s*;/.test(legacyEditorIslandSource)
      && /return\s*\(\)\s*=>\s*\{[\s\S]*setLegacyHostReady\s*\(\s*false\s*\)\s*;[\s\S]*parkedParent\.insertBefore\s*\(\s*legacyStudioRoot\s*,\s*parkedBefore\?\.parentNode\s*===\s*parkedParent\s*\?\s*parkedBefore\s*:\s*null\s*\)\s*;[\s\S]*\}\s*;/.test(legacyEditorIslandSource)
      && /useShellCommandLifecycle\s*\(\s*['"]studio['"]\s*,\s*legacyHostReady\s*\?\s*legacyStudioLifecycle\s*:\s*null\s*\)/.test(legacyEditorIslandSource)
      && /className=['"]legacy-studio-host['"]\s+role=['"]region['"]\s+aria-label=['"]Studio editor['"]/.test(legacyEditorIslandSource),
    'LegacyEditorIsland parks, mounts, and reparks legacy-studio-root with the Studio shortcut/menu lifecycle'
  );
  check(
    legacyRegistrationImports.length === 2
      && /window\.mountRecorderPanel\s*=\s*function mountRecorderPanel\s*\(/.test(recorderPanelSource)
      && /window\.mountLegacyStudio\s*=\s*function mountLegacyStudio\s*\(/.test(studioSource)
      && !/\bmount(?:LegacyStudio|RecorderPanel)\s*\(/.test(rendererMainSource),
    'main registers legacy mount functions without independently initializing Studio'
  );
  const recorderPanelGuardIndex = recorderPanelSource.indexOf('if (recorderPanelMounted) return;');
  const firstRecorderPanelBindingIndex = Math.min(
    ...['.addEventListener(', '.onclick =', '.onchange =']
      .map((needle) => recorderPanelSource.indexOf(needle))
      .filter((index) => index >= 0)
  );
  check(
    /let\s+recorderPanelMounted\s*=\s*false\s*;/.test(recorderPanelSource)
      && /if\s*\(recorderPanelMounted\)\s*return\s*;\s*\n\s*recorderPanelMounted\s*=\s*true\s*;/.test(recorderPanelSource)
      && recorderPanelGuardIndex >= 0
      && recorderPanelGuardIndex < firstRecorderPanelBindingIndex,
    'recorder panel mount is idempotent before any event binding across Studio route remounts'
  );
  check(
    /type\s+ShellCommandLifecycle\s*=\s*\{\s*\n\s*mountShortcutMenuLifecycle\s*:\s*\(\)\s*=>\s*\(\)\s*=>\s*void\s*;\s*\n\s*\}/.test(legacyEditorIslandSource)
      && /function\s+useShellCommandLifecycle\s*\(/.test(legacyEditorIslandSource)
      && /useEffect\s*\(\s*\(\)\s*=>\s*\{[\s\S]*return\s+lifecycle\.mountShortcutMenuLifecycle\s*\(\s*\)\s*;[\s\S]*\},\s*\[\s*view\s*,\s*lifecycle\s*\]\s*\)/.test(legacyEditorIslandSource)
      && !/document\.getElementById\s*\(\s*['"]legacy-studio-root['"]\s*\)/.test(appShellSource)
      && !/\bmountLegacyStudio\b/.test(appShellSource)
      && !/\bmountRecorderPanel\b/.test(appShellSource),
    'LegacyEditorIsland owns the typed React shortcut/menu lifecycle and AppShell has no direct legacy mount calls'
  );
  const legacyGuardIndex = studioSource.indexOf('if (mountLegacyStudioShortcutLifecycle) return mountLegacyStudioShortcutLifecycle();');
  const firstLegacyEventBindingIndex = studioSource.indexOf('.addEventListener(');
  check(
    /let\s+mountLegacyStudioShortcutLifecycle\s*:\s*null\s*\|\s*\(\(\)\s*=>\s*\(\)\s*=>\s*void\)\s*=\s*null\s*;/.test(studioSource)
      && /if\s*\(mountLegacyStudioShortcutLifecycle\)\s*return\s+mountLegacyStudioShortcutLifecycle\(\);/.test(studioSource)
      && legacyGuardIndex >= 0
      && legacyGuardIndex < firstLegacyEventBindingIndex
      && /mountLegacyStudioShortcutLifecycle\s*=\s*\(\)\s*=>\s*\{[\s\S]*const\s+unsubscribeCommands\s*=\s*onCommand\([\s\S]*const\s+unsubscribeKeyboardShortcuts\s*=\s*subscribeKeyboardShortcuts\(\);[\s\S]*return\s*\(\)\s*=>\s*\{[\s\S]*unsubscribeKeyboardShortcuts\(\);[\s\S]*unsubscribeCommands\(\);[\s\S]*\};[\s\S]*\};/.test(studioSource),
    'legacy Studio initializes DOM event handlers once and re-enters only the shortcut/menu lifecycle across route switches'
  );
  check(
    appShellDirectSubscriptions.length === 0,
    'AppShell lifecycle boundary does not duplicate raw shortcut or menu subscriptions'
  );
}

{
  let editorAvailable = false;
  const invocations = [];
  const off = onCommand(
    (command) => invocations.push(command),
    (command) => command === 'file:new-take' || editorAvailable,
  );

  for (const command of KEYBOARD_COMMAND_IDS) dispatchCommand(command);
  check(
    JSON.stringify(invocations) === JSON.stringify(['file:new-take']),
    'unavailable editor commands do not dispatch'
  );

  editorAvailable = true;
  for (const command of KEYBOARD_COMMAND_IDS) dispatchCommand(command);
  check(
    JSON.stringify(invocations.slice(1)) === JSON.stringify(KEYBOARD_COMMAND_IDS),
    'every keyboard command reaches an available handler'
  );
  off();
}

{
  const macSplit = chordFromKeyEvent({ key: 'b', shiftKey: false, metaKey: true, ctrlKey: false, altKey: false }, true);
  check(findBindingForChord(macSplit)?.id === 'timeline:split', 'Cmd+B on mac resolves to timeline:split');

  const winSplit = chordFromKeyEvent({ key: 'b', shiftKey: false, metaKey: false, ctrlKey: true, altKey: false }, false);
  check(findBindingForChord(winSplit)?.id === 'timeline:split', 'Ctrl+B on windows resolves to timeline:split');

  const markIn = chordFromKeyEvent({ key: 'i', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false }, true);
  check(findBindingForChord(markIn)?.id === 'timeline:mark-in', 'bare I resolves to timeline:mark-in');

  const space = chordFromKeyEvent({ key: ' ', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false }, true);
  check(findBindingForChord(space)?.id === 'timeline:play-pause', 'Space resolves to timeline:play-pause');

  const rippleDelete = chordFromKeyEvent({ key: 'Delete', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false }, true);
  check(findBindingForChord(rippleDelete)?.id === 'timeline:delete-ripple', 'Delete resolves to timeline:delete-ripple');

  const unbound = chordFromKeyEvent({ key: 'z', shiftKey: false, metaKey: true, ctrlKey: false, altKey: false }, true);
  check(findBindingForChord(unbound) === undefined, 'Cmd+Z has no registry entry');
}

{
  check(isTypingTarget({ tagName: 'INPUT', isContentEditable: false }), 'INPUT is a typing target');
  check(isTypingTarget({ tagName: 'TEXTAREA', isContentEditable: false }), 'TEXTAREA is a typing target');
  check(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), 'contentEditable DIV is a typing target');
  check(!isTypingTarget({ tagName: 'DIV', isContentEditable: false }), 'plain DIV is not a typing target');
  check(!isTypingTarget({ tagName: 'BODY', isContentEditable: false }), 'BODY is not a typing target');

  for (const binding of SHORTCUT_REGISTRY) {
    check(binding.guardTyping === true, `'${binding.id}' is guarded while typing`);
  }
}

console.log(JSON.stringify({ ok: true, cases }));
