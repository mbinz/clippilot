import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../../src/db/migrations/runner.js';
import { StoryRepository } from '../../../../src/db/repositories/story.repository.js';
import { ProjectRepository } from '../../../../src/db/repositories/project.repository.js';
import { ClipRepository } from '../../../../src/db/repositories/clip.repository.js';

describe('StoryRepository', () => {
  let db: Database.Database;
  let storyRepo: StoryRepository;
  let projectRepo: ProjectRepository;
  let clipRepo: ClipRepository;
  let projectId: number;
  let clipId1: number;
  let clipId2: number;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    storyRepo = new StoryRepository(db);
    projectRepo = new ProjectRepository(db);
    clipRepo = new ClipRepository(db);

    projectId = projectRepo.findOrCreate('Test Project').id;

    clipId1 = clipRepo.insert({
      project_id: projectId,
      file_path: '/videos/clip1.mp4',
      proxy_path: null,
      file_hash: 'hash1',
      file_size: 1000,
      duration_sec: 10,
      resolution: '1920x1080',
      fps: 30,
      nb_frames: 300,
      has_video: 1,
      has_audio: 1,
      codec: 'h264',
      recorded_at: null,
      start_timecode: null,
      location: null,
      manual_tags: null,
      people: null,
    }).id;

    clipId2 = clipRepo.insert({
      project_id: projectId,
      file_path: '/videos/clip2.mp4',
      proxy_path: null,
      file_hash: 'hash2',
      file_size: 2000,
      duration_sec: 20,
      resolution: '1920x1080',
      fps: 30,
      nb_frames: 600,
      has_video: 1,
      has_audio: 1,
      codec: 'h264',
      recorded_at: null,
      start_timecode: null,
      location: null,
      manual_tags: null,
      people: null,
    }).id;
  });

  it('creates a story', () => {
    const story = storyRepo.createStory(projectId, 'Urlaub Mallorca', 'Best moments', 180);
    expect(story.id).toBe(1);
    expect(story.name).toBe('Urlaub Mallorca');
    expect(story.target_duration_sec).toBe(180);
  });

  it('adds segments', () => {
    const story = storyRepo.createStory(projectId, 'Test Story');
    storyRepo.addSegment(story.id, clipId1, 1, 0, 10, 'intro');
    storyRepo.addSegment(story.id, clipId2, 2, 5, 15, 'highlight');

    const full = storyRepo.getStoryWithSegments(story.id);
    expect(full).not.toBeNull();
    expect(full!.segments).toHaveLength(2);
    expect(full!.segments[0].position).toBe(1);
    expect(full!.segments[1].position).toBe(2);
    expect(full!.segments[0].file_path).toBe('/videos/clip1.mp4');
  });

  it('returns null for nonexistent story', () => {
    expect(storyRepo.getStoryWithSegments(999)).toBeNull();
  });

  it('lists stories by project', () => {
    storyRepo.createStory(projectId, 'Story A');
    storyRepo.createStory(projectId, 'Story B');
    const list = storyRepo.listByProject(projectId);
    expect(list).toHaveLength(2);
  });

  it('replaces segments', () => {
    const story = storyRepo.createStory(projectId, 'Test');
    storyRepo.addSegment(story.id, clipId1, 1, 0, 10);

    storyRepo.replaceSegments(story.id, [
      { clipId: clipId2, position: 1, startSec: 0, endSec: 20, role: 'intro' },
    ]);

    const full = storyRepo.getStoryWithSegments(story.id)!;
    expect(full.segments).toHaveLength(1);
    expect(full.segments[0].clip_id).toBe(clipId2);
  });
});
