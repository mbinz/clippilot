interface QualitySliderProps {
  value: number;
  onChange: (value: number) => void;
}

export function QualitySlider({ value, onChange }: QualitySliderProps) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        Min Quality: {value > 0 ? value.toFixed(1) : 'Any'}
      </label>
      <input
        type="range"
        min="0"
        max="5"
        step="0.5"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
      />
    </div>
  );
}
