import type { StoryboardService } from './service.js';

/** Human-readable operation labels shared by the routes and the CLI. Call before the mutation (names may vanish). */
export const labels = {
  addScene: (name: string) => `Add scene "${name}"`,
  renameScene: (name: string) => `Rename scene to "${name}"`,
  moveScene: (svc: StoryboardService, id: number) => `Move scene "${svc.sceneName(id)}"`,
  deleteScene: (svc: StoryboardService, id: number) => `Delete scene "${svc.sceneName(id)}"`,
  sceneEvent: (svc: StoryboardService, id: number) => `Set event of scene "${svc.sceneName(id)}"`,
  addPanel: (svc: StoryboardService, sceneId: number) => `Add panel to scene "${svc.sceneName(sceneId)}"`,
  deletePanel: (svc: StoryboardService, id: number) => `Delete panel ${svc.panelNo(id)}`,
  movePanel: (svc: StoryboardService, id: number) => `Move panel ${svc.panelNo(id)}`,
  intent: (svc: StoryboardService, id: number) => `Edit intent of panel ${svc.panelNo(id)}`,
  trimMoment: () => 'Trim moment',
  cutOut: () => 'Cut out of moment',
  momentSpeed: (speed: number) => `Speed ${Math.round(speed * 100)} %`,
  /** hero = ★; null / solid = no ★; filler is spelled out. */
  momentTier: (tier: string | null) => (tier === 'hero' ? '\u2605' : tier === 'filler' ? 'Tier filler' : 'Remove \u2605'),
  resetMoment: () => 'Reset moment',
  place: (svc: StoryboardService, id: number) => `Place moment in panel ${svc.panelNo(id)}`,
  pick: (svc: StoryboardService, id: number) => `Pick candidate for panel ${svc.panelNo(id)}`,
  reject: (momentId: number, reason?: string) => (reason?.trim() ? `\u{1F44E} ${reason.trim()}` : `Reject moment ${momentId}`),
  unreject: () => 'Undo \u{1F44E}',
  hideClip: (svc: StoryboardService, id: number) => `Hide clip ${svc.clipFileName(id)}`,
  unhideClip: (svc: StoryboardService, id: number) => `Unhide clip ${svc.clipFileName(id)}`,
  renameCut: (name: string) => `Rename cut to "${name}"`,
  brief: (state: string) => (state === 'confirmed' ? 'Confirm brief' : 'Set brief'),
  applyDraft: (draft: unknown) => {
    const scenes = (draft as { scenes?: unknown })?.scenes;
    const n = Array.isArray(scenes)
      ? scenes.reduce((sum: number, sc) => sum + (Array.isArray(sc?.panels) ? sc.panels.length : 0), 0)
      : 0;
    return `Apply draft (${n} panels)`;
  },
};
