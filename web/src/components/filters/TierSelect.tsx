import type { Tier } from '../../api/types';

interface TierSelectProps {
  value: Tier | '';
  onChange: (value: Tier | '') => void;
}

export function TierSelect({ value, onChange }: TierSelectProps) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">Best moment</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Tier | '')}
        className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">Any</option>
        <option value="hero">Hero</option>
        <option value="solid">Solid or better</option>
        <option value="filler">Has any moment</option>
      </select>
    </div>
  );
}
