# Database Schema

This schema defines the PostgreSQL structure in Supabase to support the Diagnosis, Challenge MVP, and Coaching Partner services.

## Tables

### 1. `profiles`
Centralized user information extending Supabase Auth.
- `id`: uuid (references auth.users)
- `nickname`: text
- `country_code`: varchar(2)
- `avatar_url`: text
- `created_at`: timestamp

### 2. `diagnosis_results`
Stores the results of the 3-minute reading diagnosis.
- `id`: uuid (primary key)
- `user_id`: uuid (optional, references profiles.id)
- `level`: varchar(2) (L1-L5)
- `type`: varchar(1) (S, A, E, X)
- `secondary_type`: varchar(1)
- `raw_scores`: jsonb
- `created_at`: timestamp

### 3. `books`
Curated library for the platform.
- `id`: text (e.g., 'B001')
- `title_en`: text
- `title_ko`: text
- `level`: varchar(2)
- `ar_score`: numeric
- `lexile_score`: text
- `cover_url`: text

### 4. `challenges`
Defines specific challenge cohorts (e.g., 13기).
- `id`: uuid
- `title`: text
- `start_date`: date
- `end_date`: date
- `is_active`: boolean

### 5. `challenge_participants`
Tracks user enrollment in challenges.
- `id`: uuid
- `challenge_id`: uuid (references challenges.id)
- `user_id`: uuid (references profiles.id)
- `target_book_id`: text (references books.id)
- `goal_days`: int (30, 66, 100)
- `status`: varchar (active, completed, dropped)
- `current_streak`: int
- `total_certifications`: int

### 6. `certifications`
Daily reading logs for the Challenge.
- `id`: uuid
- `participant_id`: uuid (references challenge_participants.id)
- `check_in_at`: timestamp
- `verification_url`: text
- `comment`: text
- `reading_mode`: varchar (intensive, independent, etc.)

## Relationships
- **Profile -> Diagnosis**: 1:N (A user can retake the diagnosis).
- **Profile -> Challenge Participants**: 1:N (A user can join multiple cohorts).
- **Challenge -> Challenge Participants**: 1:N.
- **Participant -> Certifications**: 1:N (One entry per day).

## Row Level Security (RLS)
- `profiles`: Users can read any profile but only update their own.
- `diagnosis_results`: Users can only read their own results.
- `challenge_participants`: Read access for all (for live board), write only for self.
- `certifications`: Read access for all, write only for self.
