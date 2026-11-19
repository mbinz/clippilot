import type { ProjectRepository } from '../../db/repositories/project.repository.js';
import type { Project } from '../../types/project.js';

/** Resolve --project or the single project; prints an error and sets exitCode, returning null, on failure. */
export function resolveProject(repo: ProjectRepository, name?: string): Project | null {
  const projects = repo.list();
  if (name) {
    const p = repo.findByName(name);
    if (!p) {
      console.error(`Project "${name}" not found. Projects: ${projects.map((x) => x.name).join(', ') || '(none)'}`);
      process.exitCode = 1;
    }
    return p;
  }
  if (projects.length !== 1) {
    console.error(
      projects.length === 0
        ? 'No projects found. Run "clippilot ingest <path>" first.'
        : `Multiple projects; pass --project. Projects: ${projects.map((p) => p.name).join(', ')}`,
    );
    process.exitCode = 1;
    return null;
  }
  return projects[0];
}
