# API Specification

This document defines the core API endpoints for the LiterStella platform, implemented via Cloudflare Workers and Supabase PostgREST.

## 1. Diagnosis Service

### POST `/api/v1/diagnosis/submit`
Submit diagnosis answers and receive a generated report.
- **Auth**: Optional
- **Request Body**:
  ```json
  {
    "goal": "exam",
    "stamina_answers": { "ST01": "A", ... },
    "level_answers": { "L01": "B", ... },
    "preference_answers": { "P01": "S", ... }
  }
  ```
- **Response**: `200 OK` with the `diagnosis_result` object.

## 2. Challenge MVP Service

### GET `/api/v1/challenges/active`
Fetch currently active challenge cohorts.
- **Auth**: Required
- **Response**: List of `challenge` objects.

### POST `/api/v1/challenges/join`
Join a specific challenge cohort.
- **Auth**: Required
- **Request Body**:
  ```json
  {
    "challenge_id": "uuid",
    "book_id": "B005",
    "goal_days": 30
  }
  ```

### POST `/api/v1/challenges/certify`
Log daily reading progress.
- **Auth**: Required
- **Request Body**:
  ```json
  {
    "participant_id": "uuid",
    "verification_url": "https://cafe.naver.com/...",
    "comment": "3 pages read today",
    "reading_mode": "intensive"
  }
  ```

### GET `/api/v1/challenges/board`
Fetch live leaderboard data for the current challenge.
- **Auth**: Required
- **Query Params**: `challenge_id`
- **Response**: Real-time aggregated data of participants.

## 3. Profile & Shared Services

### GET `/api/v1/profile/me`
Retrieve the current user's profile and reading history summary.
- **Auth**: Required

### PUT `/api/v1/profile/me`
Update nickname or avatar.
- **Auth**: Required

## Implementation Notes
- **Supabase SDK**: The client-side application will primarily use the Supabase JS SDK for direct DB interactions (leveraging RLS).
- **Cloudflare Workers**: Complex business logic (e.g., verifying certification URLs, processing refunds, sending weekly emails) will be handled by Workers.
- **Error Handling**: Use standard HTTP status codes (400 for bad requests, 401 for unauthorized, 500 for server errors).
