import { useEffect, useState } from 'react';
import { fetchProjects } from '../../api/client';
import type { Project } from '../../api/types';

interface HeaderProps {
  selectedProjectId: number | undefined;
  onProjectChange: (projectId: number | undefined) => void;
  activeTab: 'browse' | 'similarity';
  onTabChange: (tab: 'browse' | 'similarity') => void;
}

export function Header({ selectedProjectId, onProjectChange, activeTab, onTabChange }: HeaderProps) {
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    fetchProjects().then((res) => setProjects(res.data)).catch(() => {});
  }, []);

  return (
    <header className="bg-gray-900 text-white px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <h1 className="text-xl font-bold tracking-tight">ClipPilot</h1>
        <nav className="flex gap-1">
          <button
            onClick={() => onTabChange('browse')}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              activeTab === 'browse'
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            Browse
          </button>
          <button
            onClick={() => onTabChange('similarity')}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              activeTab === 'similarity'
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            Similar Clusters
          </button>
        </nav>
      </div>
      <select
        value={selectedProjectId ?? ''}
        onChange={(e) => onProjectChange(e.target.value ? Number(e.target.value) : undefined)}
        className="bg-gray-800 text-white text-sm px-3 py-1.5 rounded border border-gray-700"
      >
        <option value="">All Projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </header>
  );
}
