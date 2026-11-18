export const SYSTEM_PROMPT = `Du bist ein Video-Analyse-Assistent für Familien- und Urlaubsvideos.
Analysiere den folgenden Videoclip und antworte ausschließlich in JSON.`;

export const USER_PROMPT = `Analysiere diesen Videoclip. Antworte als JSON mit folgender Struktur:
{
  "scenes": [
    {
      "start_sec": 0,
      "end_sec": 15,
      "description_de": "Beschreibung auf Deutsch",
      "description_en": "Description in English",
      "subjects": ["Person 1"],
      "setting": "Ort/Setting",
      "activity": "Aktivität",
      "mood": "Stimmung",
      "visual_keywords": ["keyword1", "keyword2"]
    }
  ],
  "technical_quality": {
    "stability": 4,
    "focus": 5,
    "exposure": 4,
    "composition": 3,
    "audio_quality": 2,
    "overall_score": 3.6,
    "issues": ["beschreibung des problems"]
  },
  "editorial_value": {
    "emotional_impact": 4,
    "storytelling_potential": 3,
    "uniqueness": 2,
    "suggested_use": "B-Roll"
  },
  "clip_summary": "Kurze Zusammenfassung des Clips",
  "highlights": [
    {
      "start_sec": 3.5,
      "end_sec": 7.0,
      "description": "Description of the standout moment, in English",
      "quality": 8
    }
  ]
}

Bewertungsskala jeweils 1-5.
highlights: 0 bis 5 herausragende Momente des Clips (leeres Array, wenn es keine gibt).
start_sec und end_sec sind Zahlen in Sekunden ab Clip-Beginn. description auf Englisch.
quality ist eine ganze Zahl von 1 bis 10: wie stark der Moment als Einstellung in einem Reise-Montage-Video ist.
suggested_use muss einer von: "Hero Shot", "B-Roll", "Establishing", "Transition", "Skip" sein.`;
