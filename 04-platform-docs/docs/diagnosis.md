# Reading Diagnosis

LiterStella Reading Diagnosis is a comprehensive tool designed to assess a reader's English proficiency level and psychological reading preferences. It provides a personalized report, including recommended books and specific reading routines.

## core Methodology

The diagnosis evaluates two primary dimensions:
1. **Reading Stamina & Level**: Quantitative assessment of linguistic proficiency.
2. **Reading Type (Psychology)**: Qualitative assessment of how a reader engages with text.

### Proficiency Levels
- **L1: Intro Reader**: Focuses on building the rhythm of reading through short, emotionally engaging texts.
- **L2: Sentence-Sensing Reader**: Able to follow sentences but may lose flow if stuck on grammar/vocabulary. Needs a balance between scene comprehension and sentence analysis.
- **L3: Natural Reader**: Has independent reading power. Needs to expand into deeper, more complex works without over-stretching.
- **L4/L5**: Advanced levels focusing on high-level structures, social context, and independent literary interpretation.

### Reading Types (The "SAEX" Model)
- **S (Story Immersion)**: Motivated by plot and what happens next.
- **A (Analysis/Intensive)**: Motivated by precise understanding of sentence structures and grammar.
- **E (Emotion/Empathy)**: Motivated by beautiful sentences and emotional resonance.
- **X (Meaning Exploration)**: Motivated by symbols, background knowledge, and deep questions.

## Scoring & Algorithms

The final level is determined by a combined score of **Stamina Questions** (ST01-ST03) and **Level Questions** (L01-L06).

- **Total Score Thresholds**:
    - **L3**: $\ge 6.2$
    - **L2**: $3.5 \le \text{Score} < 6.2$
    - **L1**: $< 3.5$

The **Reading Type** is determined by the frequency of choices in preference questions (P01-P05) plus partial weights from stamina questions. A "Secondary Type" is also identified to refine the reading routine.

## Recommended Books Library

The system uses a curated list of books mapped to specific levels and types.

| ID | Title | Level | AR | Lexile | Types |
|---|---|---|---|---|---|
| B001 | Daddy-Long-Legs | L1 | 6.1 | 925L | E, A |
| B005 | Anne of Green Gables | L2 | 7.3 | 990L | S, E, A |
| B009 | Little Women | L3 | 7.6 | 1100L | E, A, S |
| B013 | Pride and Prejudice | L4 | 12.0| 1190L| A, E, X |
| B018 | The Great Gatsby | L5 | 7.3 | 1070L| X, E, A |

*(Full library includes 20+ titles plus the complete Harry Potter series)*

## Reading Routines

Each type receives a specific 4-step routine:
- **Story (S)**: Plot summary -> Scene summary -> Flow maintenance.
- **Analysis (A)**: Slow reading -> Structure analysis (2 sentences) -> Expression replacement.
- **Emotion (E)**: Sentence selection -> Emotional memo -> Read aloud -> Transcription.
- **Exploration (X)**: Background check -> Symbol marking -> Thematic questioning -> Reflection.

## Technical Integration
- **Storage**: LocalStorage for session persistence.
- **Lead Gen**: Netlify Forms integration for capturing leads.
- **Event Logging**: Custom event logging for user behavior analysis.
