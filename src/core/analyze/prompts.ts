export const SYSTEM_PROMPT = `Du bist ein Video-Analyse-Assistent für Familien- und Urlaubsvideos.
Analysiere den folgenden Videoclip und antworte ausschließlich in JSON.`;

export const USER_PROMPT = `Analysiere diesen Videoclip. Antworte als JSON mit folgender Struktur:
{
  "scenes": [
    {
      "start_sec": <Sekunden ab Clip-Beginn>,
      "end_sec": <Sekunden ab Clip-Beginn>,
      "description_de": "Beschreibung auf Deutsch",
      "description_en": "Description in English",
      "subjects": ["Person 1"],
      "setting": "<kurzer englischer Tag, z.B. marina>",
      "activity": "<kurzer englischer Tag, z.B. dolphin watching>",
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
      "start_sec": <Sekunden ab Clip-Beginn>,
      "end_sec": <Sekunden ab Clip-Beginn>,
      "description": "Description of the standout moment, in English",
      "quality": 8
    }
  ]
}

Bewertungsskala jeweils 1-5.
highlights: 0 bis 5 herausragende Momente des Clips (leeres Array, wenn es keine gibt).
start_sec und end_sec sind Zahlen in Sekunden ab Clip-Beginn und müssen aus dem stammen, was im Video tatsächlich zu sehen ist (keine Beispielwerte übernehmen). description auf Englisch.
quality ist eine ganze Zahl von 1 bis 10: wie stark der Moment als Einstellung in einem Reise-Montage-Video ist.
setting und activity: kurze englische Tags in Kleinbuchstaben (lowercase), je 1-3 Wörter (1-3 words), z.B. "marina", "open sea", "dolphin watching". Keine ganzen Sätze, wiederverwendbar über Clips hinweg.
suggested_use muss einer von: "Hero Shot", "B-Roll", "Establishing", "Transition", "Skip" sein.`;
