interface FacetFilterProps {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}

export function FacetFilter({ label, options, value, onChange }: FacetFilterProps) {
  if (options.length === 0) return null;

  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">All</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}
